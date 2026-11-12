import pytest
from django.contrib.auth.models import AnonymousUser

from apps.core.errors import CrossTenantAccess, TenantInactive
from apps.tenants.selectors import resolve_tenant_id

pytestmark = pytest.mark.django_db


def test_user_tenant_wins_on_a_neutral_host(user_a, tenant_a, tenant_b):
    assert resolve_tenant_id(user_a, "app.example.test") == tenant_a.id


def test_user_on_own_tenant_host_with_port(user_a, tenant_a):
    assert resolve_tenant_id(user_a, "A.Example.Test:8443") == tenant_a.id


def test_user_on_other_tenant_host_is_refused(user_a, tenant_b):
    with pytest.raises(CrossTenantAccess):
        resolve_tenant_id(user_a, "b.example.test")


def test_anonymous_request_takes_host_tenant(tenant_a):
    assert resolve_tenant_id(AnonymousUser(), "a.example.test") == tenant_a.id
    assert resolve_tenant_id(None, "a.example.test") == tenant_a.id


def test_anonymous_request_on_unknown_host_has_no_tenant(tenant_a):
    assert resolve_tenant_id(AnonymousUser(), "unknown.example.test") is None


def test_platform_user_has_no_tenant_even_on_tenant_host(make_user, tenant_a):
    assert resolve_tenant_id(make_user("platform"), "a.example.test") is None


def test_inactive_tenant_is_refused_for_users_and_hosts(user_a, tenant_a):
    tenant_a.is_active = False
    tenant_a.save()
    with pytest.raises(TenantInactive):
        resolve_tenant_id(user_a, "app.example.test")
    with pytest.raises(TenantInactive):
        resolve_tenant_id(AnonymousUser(), "a.example.test")


def test_domain_is_normalised_and_blank_becomes_null(make_tenant):
    tenant = make_tenant("clinic-c", domain="  C.Example.Test ")
    assert tenant.domain == "c.example.test"
    assert make_tenant("clinic-d", domain="").domain is None
    assert make_tenant("clinic-e").domain is None  # several tenants may have no domain
