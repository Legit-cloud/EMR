from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from apps.core.roles import Role
from apps.core.tenancy import tenant_context


@pytest.fixture(autouse=True)
def _clear_cache():
    """Throttle counters live in the cache; start every test from zero."""
    from django.core.cache import cache

    cache.clear()


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
def assign_role(db):
    from apps.accounts.models import RoleAssignment

    def assign(user, role, *, facility=None, department=None):
        with tenant_context(user.tenant_id):
            return RoleAssignment.objects.create(
                user=user, role=role, facility=facility, department=department
            )

    return assign


@pytest.fixture
def make_user(db, django_user_model, assign_role):
    def make(username, tenant=None, roles=(), *, facility=None, department=None, **kwargs):
        kwargs.setdefault("email", f"{username}@example.test")
        user = django_user_model.objects.create_user(
            username=username, password="not-a-real-password-123", tenant=tenant, **kwargs
        )
        for role in roles:
            assign_role(user, role, facility=facility, department=department)
        return user

    return make


@pytest.fixture
def user_a(make_user, tenant_a):
    return make_user("alice", tenant_a, [Role.DOCTOR])


@pytest.fixture
def user_b(make_user, tenant_b):
    return make_user("bola", tenant_b, [Role.DOCTOR])


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def otp_device(db):
    from django_otp.plugins.otp_email.models import EmailDevice

    def make(user):
        return EmailDevice.objects.create(user=user, name="test device", confirmed=True)

    return make


@pytest.fixture
def signed_in(otp_device):
    """``signed_in(user)``: a session client, with MFA satisfied unless ``mfa=False``."""
    from django_otp import DEVICE_ID_SESSION_KEY
    from django_otp.plugins.otp_email.models import EmailDevice

    def make(user, *, mfa=True):
        client = APIClient()
        client.force_login(user)
        if mfa:
            device = EmailDevice.objects.filter(user=user, confirmed=True).first()
            device = device or otp_device(user)
            session = client.session
            session[DEVICE_ID_SESSION_KEY] = device.persistent_id
            session.save()
        return client

    return make


@pytest.fixture
def token_client(db):
    """``token_client(user)``: a bearer-token client, MFA-verified unless ``mfa=False``."""
    from apps.accounts.models import ApiToken

    def make(user, *, mfa=True, ttl=timedelta(hours=1)):
        _, key = ApiToken.issue(user, ttl=ttl, mfa_verified=mfa)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
        return client

    return make


@pytest.fixture
def as_tenant():
    """Context manager fixture: ``with as_tenant(tenant): ...``."""

    def activate(tenant, user=None):
        return tenant_context(tenant.id if tenant else None, user.pk if user else None)

    return activate
