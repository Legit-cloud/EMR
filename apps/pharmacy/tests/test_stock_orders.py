"""The pharmacy stock screen: inventory and summary, vendors, ordering and partial receipt (F13).
Requirement IDs: SEC-02, SEC-03, SEC-07."""

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.pharmacy.models import Drug, StockBatch, Vendor

pytestmark = pytest.mark.django_db

STOCK = "/api/pharmacy/stock/"
VENDORS = "/api/pharmacy/vendors/"
ORDERS = "/api/pharmacy/orders/"


@pytest.fixture
def admin(make_user, signed_in, tenant_a):
    return signed_in(make_user("admin", tenant_a, [Role.TENANT_ADMIN]))


@pytest.fixture
def vendor(tenant_a):
    with tenant_context(tenant_a.id):
        return Vendor.objects.create(
            name="MedSupply Ltd", email="orders@medsupply.example.test", phone="+2348000000000"
        )


def future(days=400):
    return (timezone.localdate() + timedelta(days=days)).isoformat()


def place(client, vendor, drugs, *specs):
    """``place(client, vendor, drugs, ("paracetamol", 100, 150_00), ...)`` -> response."""
    return client.post(
        f"{ORDERS}place/",
        {
            "vendor": str(vendor.pk),
            "note": "Needed this week",
            "lines": [
                {"drug": str(drugs[key].pk), "quantity": qty, "unit_cost_minor": cost}
                for key, qty, cost in specs
            ],
        },
        format="json",
    )


def receive(client, order, *entries):
    """Each entry is (line index, quantity, batch)."""
    lines = order["lines"]
    return client.post(
        f"{ORDERS}{order['id']}/receive/",
        {
            "receipts": [
                {
                    "line": lines[i]["id"],
                    "quantity": qty,
                    "batch_number": batch,
                    "expiry_date": future(),
                }
                for i, qty, batch in entries
            ]
        },
        format="json",
    )


# -- inventory and the header summary ---------------------------------------------------


def test_summary_counts_in_stock_low_and_out_and_values_stock(pharmacist, drugs, stock, tenant_a):
    # Paracetamol has 110 unexpired units (the expired batch does not count). Lower the
    # reorder level of one drug and raise another so one is low.
    with tenant_context(tenant_a.id):
        Drug.objects.filter(pk=drugs["paracetamol"].pk).update(reorder_level=20)
    response = pharmacist.get(f"{STOCK}summary/")
    assert response.status_code == 200
    body = response.json()
    assert body["products"] == len(drugs)
    assert body["in_stock"] == 1
    assert body["out"] == len(drugs) - 1
    assert body["value_minor"] == 110 * 2500
    assert body["currency"] == "NGN"


def test_inventory_rows_carry_availability_status_and_on_order(
    pharmacist, drugs, stock, vendor, tenant_a
):
    with tenant_context(tenant_a.id):
        Drug.objects.filter(pk=drugs["paracetamol"].pk).update(reorder_level=200)
    place(pharmacist, vendor, drugs, ("paracetamol", 300, 1_000))
    response = pharmacist.get(f"{STOCK}inventory/", {"q": "paracetamol"})
    assert response.status_code == 200
    (row,) = response.json()["results"]
    assert row["available"] == 110
    assert row["stock_status"] == "low"
    assert row["on_order"] == 300
    assert row["value_minor"] == 110 * 2500


def test_inventory_filters_by_status_and_pages(pharmacist, drugs, stock):
    out = pharmacist.get(f"{STOCK}inventory/", {"status": "out", "page_size": 3}).json()
    assert out["count"] == len(drugs) - 1
    assert len(out["results"]) == 3
    assert all(r["stock_status"] == "out" for r in out["results"])
    assert pharmacist.get(f"{STOCK}inventory/", {"status": "in_stock"}).json()["count"] == 1


# -- placing orders ---------------------------------------------------------------------


def test_placing_an_order_emails_the_vendor_and_lists_it(
    pharmacist, drugs, vendor, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = place(
            pharmacist, vendor, drugs, ("paracetamol", 100, 150_00), ("aspirin", 50, 80_00)
        )
    assert response.status_code == 201
    order = response.json()
    assert order["status"] == "pending"
    assert order["reference"].startswith("PO-")
    assert order["line_count"] == 2
    assert order["units_ordered"] == 150
    assert order["units_received"] == 0
    assert order["total_minor"] == 100 * 150_00 + 50 * 80_00
    assert order["email_sent_at"]
    (message,) = [m for m in mail.outbox if order["reference"] in m.subject]
    assert message.to == ["orders@medsupply.example.test"]
    assert "Paracetamol" in message.body
    assert "Dear MedSupply Ltd" in message.body
    assert f"Quote {order['reference']}" in message.body  # the order number goes on the invoice

    listed = pharmacist.get(ORDERS).json()
    assert listed["count"] == 1
    assert listed["results"][0]["vendor_name"] == "MedSupply Ltd"


def test_a_vendor_without_an_email_still_gets_an_order_but_no_email_is_recorded(
    pharmacist, drugs, tenant_a
):
    with tenant_context(tenant_a.id):
        quiet = Vendor.objects.create(name="Walk-in supplier")
    order = place(pharmacist, quiet, drugs, ("aspirin", 10, 100)).json()
    assert order["email_sent_at"] is None


@pytest.mark.parametrize(
    "specs",
    [
        [],
        [("aspirin", 10, 100), ("aspirin", 5, 100)],
    ],
)
def test_orders_need_items_and_each_drug_once(pharmacist, drugs, vendor, specs):
    assert place(pharmacist, vendor, drugs, *specs).status_code in (400, 409)


def test_an_inactive_vendor_cannot_be_ordered_from(pharmacist, drugs, vendor):
    pharmacist.patch(f"{VENDORS}{vendor.pk}/", {"active": False}, format="json")
    response = place(pharmacist, vendor, drugs, ("aspirin", 10, 100))
    assert response.status_code == 409


# -- receiving, in full and in part -----------------------------------------------------


def test_partial_receipt_adds_stock_and_marks_the_order_partially_received(
    pharmacist, drugs, vendor
):
    order = place(pharmacist, vendor, drugs, ("aspirin", 100, 100), ("lisinopril", 40, 200)).json()
    response = receive(pharmacist, order, (0, 60, "ASP-1"))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "partially_received"
    assert body["units_received"] == 60
    assert body["lines"][0]["quantity_received"] == 60
    assert len(body["receipts"]) == 1
    with tenant_context(vendor.tenant_id):
        batch = StockBatch.objects.get(drug=drugs["aspirin"], batch_number="ASP-1")
        assert batch.quantity_on_hand == 60


def test_the_rest_completes_the_order_and_tops_up_the_same_batch(pharmacist, drugs, vendor):
    order = place(pharmacist, vendor, drugs, ("aspirin", 100, 100)).json()
    receive(pharmacist, order, (0, 60, "ASP-1"))
    body = receive(pharmacist, order, (0, 40, "ASP-1")).json()
    assert body["status"] == "complete"
    assert body["units_received"] == 100
    with tenant_context(vendor.tenant_id):
        assert (
            StockBatch.objects.get(drug=drugs["aspirin"], batch_number="ASP-1").quantity_on_hand
            == 100
        )
    assert receive(pharmacist, order, (0, 1, "ASP-2")).status_code == 409


def test_cannot_receive_more_than_is_outstanding(pharmacist, drugs, vendor):
    order = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    response = receive(pharmacist, order, (0, 11, "ASP-1"))
    assert response.status_code == 409
    assert "only 10 still expected" in response.json()["error"]["message"]
    with tenant_context(vendor.tenant_id):
        assert not StockBatch.objects.filter(batch_number="ASP-1").exists()


def test_receipt_is_all_or_nothing(pharmacist, drugs, vendor):
    order = place(pharmacist, vendor, drugs, ("aspirin", 10, 100), ("lisinopril", 10, 100)).json()
    response = receive(pharmacist, order, (0, 5, "ASP-1"), (1, 99, "LIS-1"))
    assert response.status_code == 409
    with tenant_context(vendor.tenant_id):
        assert not StockBatch.objects.filter(batch_number="ASP-1").exists()
    assert pharmacist.get(f"{ORDERS}{order['id']}/").json()["status"] == "pending"


def test_expired_stock_and_clashing_batch_expiry_are_refused(pharmacist, drugs, vendor):
    order = place(pharmacist, vendor, drugs, ("aspirin", 30, 100)).json()
    line = order["lines"][0]["id"]
    expired = pharmacist.post(
        f"{ORDERS}{order['id']}/receive/",
        {
            "receipts": [
                {
                    "line": line,
                    "quantity": 5,
                    "batch_number": "OLD",
                    "expiry_date": timezone.localdate().isoformat(),
                }
            ]
        },
        format="json",
    )
    assert expired.status_code == 409
    receive(pharmacist, order, (0, 5, "ASP-1"))
    clash = pharmacist.post(
        f"{ORDERS}{order['id']}/receive/",
        {
            "receipts": [
                {
                    "line": line,
                    "quantity": 5,
                    "batch_number": "ASP-1",
                    "expiry_date": future(900),
                }
            ]
        },
        format="json",
    )
    assert clash.status_code == 409


def test_only_an_untouched_order_can_be_cancelled(pharmacist, drugs, vendor):
    first = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    assert pharmacist.post(f"{ORDERS}{first['id']}/cancel/").json()["status"] == "cancelled"
    second = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    receive(pharmacist, second, (0, 1, "ASP-1"))
    assert pharmacist.post(f"{ORDERS}{second['id']}/cancel/").status_code == 409


def test_search_filter_and_sort_orders(pharmacist, drugs, vendor, tenant_a):
    with tenant_context(tenant_a.id):
        other = Vendor.objects.create(name="Zenith Pharma")
    cheap = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    big = place(pharmacist, other, drugs, ("aspirin", 10, 5_000)).json()
    by_vendor = pharmacist.get(ORDERS, {"q": "zenith"}).json()
    assert [r["id"] for r in by_vendor["results"]] == [big["id"]]
    by_number = pharmacist.get(ORDERS, {"q": cheap["reference"]}).json()
    assert [r["id"] for r in by_number["results"]] == [cheap["id"]]
    ranked = pharmacist.get(ORDERS, {"ordering": "-total"}).json()
    assert [r["id"] for r in ranked["results"]] == [big["id"], cheap["id"]]
    pharmacist.post(f"{ORDERS}{cheap['id']}/cancel/")
    assert pharmacist.get(ORDERS, {"status": "cancelled"}).json()["count"] == 1


# -- who may do what, tenants and the audit trail ---------------------------------------


def test_admin_and_finance_view_but_cannot_order_or_receive(
    admin, pharmacist, drugs, vendor, make_user, signed_in, tenant_a
):
    order = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    finance = signed_in(make_user("fin", tenant_a, [Role.FINANCE]))
    for client in (admin, finance):
        assert client.get(ORDERS).status_code == 200
        assert client.get(f"{ORDERS}{order['id']}/").status_code == 200
        assert place(client, vendor, drugs, ("aspirin", 1, 1)).status_code == 403
        assert receive(client, order, (0, 1, "X")).status_code == 403
        assert client.post(f"{ORDERS}{order['id']}/cancel/").status_code == 403
        assert client.post(VENDORS, {"name": "New"}, format="json").status_code == 403
    assert admin.get(f"{STOCK}summary/").status_code == 200


@pytest.mark.parametrize("role", [Role.DOCTOR, Role.NURSE, Role.FRONT_DESK, Role.BILLING_OFFICER])
def test_clinical_and_front_roles_have_no_access_to_ordering(
    role, make_user, signed_in, tenant_a, drugs, vendor
):
    client = signed_in(make_user("x", tenant_a, [role]))
    assert client.get(ORDERS).status_code == 403
    assert client.get(VENDORS).status_code == 403
    assert client.get(f"{STOCK}summary/").status_code == 403
    assert client.get(f"{STOCK}inventory/").status_code == 403


def test_a_user_in_another_tenant_sees_none_of_it(
    pharmacist, drugs, vendor, make_user, signed_in, tenant_b
):
    order = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    stranger = signed_in(make_user("other-pharmacist", tenant_b, [Role.PHARMACIST]))
    assert stranger.get(ORDERS).json()["count"] == 0
    assert stranger.get(VENDORS).json() == []
    assert stranger.get(f"{ORDERS}{order['id']}/").status_code == 404
    assert receive(stranger, order, (0, 1, "X")).status_code in (400, 404)
    assert stranger.get(f"{STOCK}inventory/").json()["count"] == 0


def test_placing_and_receiving_are_audited(pharmacist, drugs, vendor):
    order = place(pharmacist, vendor, drugs, ("aspirin", 10, 100)).json()
    receive(pharmacist, order, (0, 5, "ASP-1"))
    with tenant_context(vendor.tenant_id):
        entries = AuditEntry.objects.filter(resource__icontains="purchaseorder")
        assert {e.action for e in entries} >= {"create", "update"}


def test_vendors_can_be_added_and_renamed_but_names_stay_unique(pharmacist, vendor):
    created = pharmacist.post(VENDORS, {"name": "Brand New Co", "email": "a@b.test"}, format="json")
    assert created.status_code == 201
    renamed = pharmacist.patch(
        f"{VENDORS}{created.json()['id']}/", {"name": "Brand New"}, format="json"
    )
    assert renamed.json()["name"] == "Brand New"
    duplicate = pharmacist.post(VENDORS, {"name": "MedSupply Ltd"}, format="json")
    assert duplicate.status_code == 400
