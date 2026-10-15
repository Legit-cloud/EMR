"""SEC-07: tenant isolation in the data layer, proven through the API and the models.

Uses the test-only ``tests.tenancy_app`` (Folder, Record) so the whole path is exercised:
middleware or DRF authentication -> tenant context -> scoped manager -> database.
"""

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.core.api.mixins import TenantModelViewSet
from apps.core.errors import CrossTenantAccess, TenantContextMissing
from apps.core.tenancy import get_current_tenant_id
from tests.tenancy_app.models import Folder, Record

pytestmark = pytest.mark.django_db


@pytest.fixture
def data(tenant_a, tenant_b, as_tenant):
    with as_tenant(tenant_a):
        folder_a = Folder.objects.create(name="A folder")
        record_a = Record.objects.create(title="A record", folder=folder_a)
    with as_tenant(tenant_b):
        folder_b = Folder.objects.create(name="B folder")
        record_b = Record.objects.create(title="B record", folder=folder_b)
    return {"folder_a": folder_a, "record_a": record_a, "folder_b": folder_b, "record_b": record_b}


@pytest.fixture
def client_a(signed_in, user_a):
    """Session-authenticated client: the tenant middleware resolves the tenant."""
    return signed_in(user_a)


# -- through the API -------------------------------------------------------------


def test_sec_07_list_returns_only_own_tenant_rows(client_a, data):
    response = client_a.get("/test-api/records/")
    assert response.status_code == 200
    assert [r["title"] for r in response.json()["results"]] == ["A record"]


def test_sec_07_cannot_read_another_tenants_row(client_a, data):
    response = client_a.get(f"/test-api/records/{data['record_b'].id}/")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_sec_07_cannot_update_another_tenants_row(client_a, data):
    response = client_a.patch(
        f"/test-api/records/{data['record_b'].id}/", {"title": "hacked"}, format="json"
    )
    assert response.status_code == 404
    assert Record.all_tenants.get(pk=data["record_b"].id).title == "B record"


def test_sec_07_cannot_delete_another_tenants_row(client_a, data):
    response = client_a.delete(f"/test-api/folders/{data['folder_b'].id}/")
    assert response.status_code == 404
    assert Folder.all_tenants.filter(pk=data["folder_b"].id).exists()


def test_sec_07_create_always_uses_callers_tenant(client_a, data, tenant_a, tenant_b):
    response = client_a.post(
        "/test-api/folders/", {"name": "new", "tenant": str(tenant_b.id)}, format="json"
    )
    assert response.status_code == 201
    assert Folder.all_tenants.get(pk=response.json()["id"]).tenant_id == tenant_a.id


def test_sec_07_cannot_link_to_another_tenants_row(client_a, data):
    response = client_a.post(
        "/test-api/records/", {"title": "x", "folder": str(data["folder_b"].id)}, format="json"
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "cross_tenant_access"
    assert not Record.all_tenants.filter(title="x").exists()


def test_sec_07_token_auth_is_scoped_too(token_client, user_a, data):
    """Bearer tokens are resolved inside DRF, after the middleware: DRF must still scope."""
    client = token_client(user_a)
    response = client.get("/test-api/records/")
    assert [r["title"] for r in response.json()["results"]] == ["A record"]
    response = client.get(f"/test-api/records/{data['record_b'].id}/")
    assert response.status_code == 404


def test_sec_07_user_on_another_tenants_host_is_refused(client_a, data):
    response = client_a.get("/test-api/records/", HTTP_HOST="b.example.test")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "cross_tenant_access"


def test_sec_07_user_of_inactive_tenant_is_refused(client_a, tenant_a, data):
    tenant_a.is_active = False
    tenant_a.save()
    response = client_a.get("/test-api/records/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant_inactive"


def test_sec_07_platform_user_without_tenant_gets_no_tenant_data(signed_in, make_user, data):
    response = signed_in(make_user("platform-admin", is_superuser=True)).get("/test-api/records/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "no_tenant"


def test_sec_07_anonymous_requests_are_rejected(api_client, data):
    response = api_client.get("/test-api/records/", HTTP_HOST="a.example.test")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_tenant_context_is_cleared_after_each_request(client_a, token_client, user_a, data):
    client_a.get("/test-api/records/")
    assert get_current_tenant_id() is None
    token_client(user_a).get("/test-api/records/")
    assert get_current_tenant_id() is None


# -- at the model layer ----------------------------------------------------------


def test_sec_07_default_manager_returns_nothing_without_tenant_context(data):
    assert Record.objects.count() == 0
    assert Record.all_tenants.count() == 2


def test_sec_07_default_manager_is_scoped_to_current_tenant(data, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        assert list(Record.objects.values_list("title", flat=True)) == ["A record"]


def test_sec_07_saving_without_tenant_context_fails(db):
    with pytest.raises(TenantContextMissing):
        Folder.objects.create(name="orphan")


def test_sec_07_cannot_save_another_tenants_row(data, tenant_a, as_tenant):
    folder_b = Folder.all_tenants.get(pk=data["folder_b"].id)
    folder_b.name = "changed"
    with as_tenant(tenant_a), pytest.raises(CrossTenantAccess):
        folder_b.save()


def test_sec_07_cannot_delete_another_tenants_row_directly(data, tenant_a, as_tenant):
    folder_b = Folder.all_tenants.get(pk=data["folder_b"].id)
    with as_tenant(tenant_a), pytest.raises(CrossTenantAccess):
        folder_b.delete()


def test_sec_07_cannot_create_row_for_another_tenant(data, tenant_a, tenant_b, as_tenant):
    with as_tenant(tenant_a), pytest.raises(CrossTenantAccess):
        Folder.objects.create(name="sneaky", tenant=tenant_b)


def test_sec_07_bulk_create_is_checked(data, tenant_a, tenant_b, as_tenant):
    with as_tenant(tenant_a):
        Folder.objects.bulk_create([Folder(name="one"), Folder(name="two")])
        assert Folder.objects.filter(name__in=["one", "two"]).count() == 2
        with pytest.raises(CrossTenantAccess):
            Folder.objects.bulk_create([Folder(name="three", tenant=tenant_b)])


def test_sec_07_foreign_key_to_another_tenants_row_is_rejected(data, tenant_a, as_tenant):
    with as_tenant(tenant_a), pytest.raises(CrossTenantAccess):
        Record.objects.create(title="bad link", folder_id=data["folder_b"].id)


def test_sec_07_queryset_update_cannot_reach_another_tenant(data, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        Folder.objects.update(name="renamed")
    assert Folder.all_tenants.get(pk=data["folder_b"].id).name == "B folder"


def test_created_by_and_updated_by_are_stamped_from_context(tenant_a, user_a, as_tenant):
    with as_tenant(tenant_a, user_a):
        folder = Folder.objects.create(name="stamped")
    assert folder.created_by_id == user_a.pk
    assert folder.updated_by_id == user_a.pk


def test_viewset_with_class_level_queryset_is_refused():
    with pytest.raises(ImproperlyConfigured):

        class BadViewSet(TenantModelViewSet):  # noqa: F841
            queryset = Folder.objects.all()


def test_sec_07_every_tenant_model_defaults_to_the_scoped_manager():
    """A subclass with its own Meta must not silently default to the unscoped manager."""
    from django.apps import apps

    from apps.core.models import TenantManager, TenantModel

    tenant_models = [m for m in apps.get_models() if issubclass(m, TenantModel)]
    assert tenant_models
    for model in tenant_models:
        assert isinstance(model._default_manager, TenantManager), model.__name__
