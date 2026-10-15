import pytest
from rest_framework.test import APIClient

from apps.core.tenancy import tenant_context


@pytest.fixture
def make_tenant(db):
    from apps.tenants.models import Tenant

    def make(slug, **kwargs):
        kwargs.setdefault("name", slug.replace("-", " ").title())
        return Tenant.objects.create(slug=slug, **kwargs)

    return make


@pytest.fixture
def tenant_a(make_tenant):
    return make_tenant("clinic-a", domain="a.example.test")


@pytest.fixture
def tenant_b(make_tenant):
    return make_tenant("clinic-b", domain="b.example.test")


@pytest.fixture
def make_user(db, django_user_model):
    def make(username, tenant=None, **kwargs):
        return django_user_model.objects.create_user(
            username=username, password="not-a-real-password-123", tenant=tenant, **kwargs
        )

    return make


@pytest.fixture
def user_a(make_user, tenant_a):
    return make_user("alice", tenant_a)


@pytest.fixture
def user_b(make_user, tenant_b):
    return make_user("bola", tenant_b)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def as_tenant():
    """Context manager fixture: ``with as_tenant(tenant): ...``."""

    def activate(tenant, user=None):
        return tenant_context(tenant.id if tenant else None, user.pk if user else None)

    return activate
