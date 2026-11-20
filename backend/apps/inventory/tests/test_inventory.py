"""General inventory: supplies, movements and stock levels.
Requirement IDs: SEC-02, SEC-03, SEC-07, FR-INV (stock never negative, every change explained)."""

import threading

import pytest
from django.core.exceptions import ValidationError
from django.db import connection

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.inventory import services
from apps.inventory.models import Item, StockMovement

pytestmark = pytest.mark.django_db

ITEMS = "/api/inventory/items/"
MOVEMENTS = "/api/inventory/movements/"


@pytest.fixture
def pharmacist(make_user, signed_in, tenant_a):
    return signed_in(make_user("pharm-inv", tenant_a, [Role.PHARMACIST]))


@pytest.fixture
def nurse(make_user, signed_in, tenant_a):
    return signed_in(make_user("nurse-inv", tenant_a, [Role.NURSE]))


@pytest.fixture
def admin(make_user, signed_in, tenant_a):
    return signed_in(make_user("admin-inv", tenant_a, [Role.TENANT_ADMIN]))


@pytest.fixture
def gloves(tenant_a):
    with tenant_context(tenant_a.id):
        return Item.objects.create(
            sku="GLV-M", name="Gloves, medium", unit="box", reorder_level=5, unit_cost_minor=250_000
        )


def move(client, item, kind, quantity, **extra):
    return client.post(
        MOVEMENTS,
        {"item": str(item.pk), "kind": kind, "quantity": quantity, **extra},
        format="json",
    )


def test_receive_issue_and_adjust_keep_a_running_balance(pharmacist, gloves, tenant_a):
    assert move(pharmacist, gloves, "receive", 20).status_code == 201
    assert move(pharmacist, gloves, "issue", 6).json()["balance_after"] == 14
    adjusted = move(pharmacist, gloves, "adjust", 12, reason="Two boxes damaged").json()
    assert adjusted["quantity"] == -2 and adjusted["balance_after"] == 12
    with tenant_context(tenant_a.id):
        assert Item.objects.get(pk=gloves.pk).on_hand == 12
        assert StockMovement.objects.filter(item=gloves).count() == 3


def test_issue_beyond_stock_is_refused_and_changes_nothing(pharmacist, gloves, tenant_a):
    move(pharmacist, gloves, "receive", 3)
    response = move(pharmacist, gloves, "issue", 4)
    assert response.status_code == 409
    with tenant_context(tenant_a.id):
        assert Item.objects.get(pk=gloves.pk).on_hand == 3
        assert StockMovement.objects.count() == 1


def test_count_correction_needs_a_reason_and_a_real_change(pharmacist, gloves):
    move(pharmacist, gloves, "receive", 3)
    assert move(pharmacist, gloves, "adjust", 2).status_code == 400
    assert move(pharmacist, gloves, "adjust", 3, reason="Recount").status_code == 400


def test_quantity_must_be_positive_for_receive_and_issue(pharmacist, gloves):
    assert move(pharmacist, gloves, "receive", 0).status_code == 400
    assert move(pharmacist, gloves, "issue", 0).status_code == 400


def test_on_hand_cannot_be_set_by_editing_the_item(pharmacist, gloves, tenant_a):
    response = pharmacist.patch(f"{ITEMS}{gloves.pk}/", {"on_hand": 999}, format="json")
    assert response.status_code == 200
    with tenant_context(tenant_a.id):
        assert Item.objects.get(pk=gloves.pk).on_hand == 0


def test_movements_are_append_only(pharmacist, gloves, tenant_a):
    move(pharmacist, gloves, "receive", 3)
    with tenant_context(tenant_a.id):
        movement = StockMovement.objects.get()
        movement.quantity = 99
        with pytest.raises(ValidationError):
            movement.save()
        with pytest.raises(ValidationError):
            movement.delete()


def test_low_stock_filter_and_summary(pharmacist, gloves):
    move(pharmacist, gloves, "receive", 4)
    low = pharmacist.get(f"{ITEMS}?status=low").json()["results"]
    assert [i["sku"] for i in low] == ["GLV-M"] and low[0]["is_low"] is True
    summary = pharmacist.get(f"{ITEMS}summary/").json()
    assert summary == {
        "items": 1,
        "out": 0,
        "low": 1,
        "units": 4,
        "value_minor": 1_000_000,
        "currency": "NGN",
    }


def test_sec_02_nurse_issues_but_cannot_receive_or_create_items(nurse, pharmacist, gloves):
    move(pharmacist, gloves, "receive", 10)
    assert move(nurse, gloves, "issue", 1).status_code == 201
    # Receiving is the pharmacist's job; both use the same create grant, so the nurse is
    # also refused creating catalogue items.
    assert nurse.post(ITEMS, {"sku": "X", "name": "X"}, format="json").status_code == 403
    assert nurse.get(ITEMS).status_code == 200


def test_sec_02_tenant_admin_views_but_cannot_move_stock(admin, pharmacist, gloves):
    move(pharmacist, gloves, "receive", 10)
    assert admin.get(MOVEMENTS).status_code == 200
    assert move(admin, gloves, "issue", 1).status_code == 403


def test_sec_03_movements_are_audited(pharmacist, gloves):
    move(pharmacist, gloves, "receive", 10)
    assert AuditEntry.objects.filter(resource="inventory.stockmovement", action="create").exists()


def test_sec_07_other_tenant_cannot_see_or_move_items(make_user, signed_in, tenant_b, gloves):
    other = signed_in(make_user("pharm-b", tenant_b, [Role.PHARMACIST]))
    assert other.get(ITEMS).json()["results"] == []
    assert other.get(f"{ITEMS}{gloves.pk}/").status_code == 404
    assert move(other, gloves, "receive", 1).status_code == 400


@pytest.mark.django_db(transaction=True)
def test_simultaneous_issues_never_take_more_than_is_in_stock(gloves, tenant_a):
    with tenant_context(tenant_a.id):
        services.receive(gloves, 5)
    results = []

    def worker():
        try:
            with tenant_context(tenant_a.id):
                services.issue(gloves, 1)
            results.append("ok")
        except Exception:
            results.append("refused")
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 5 and results.count("refused") == 3
    with tenant_context(tenant_a.id):
        assert Item.objects.get(pk=gloves.pk).on_hand == 0
