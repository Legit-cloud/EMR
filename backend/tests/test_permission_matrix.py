"""SEC-02: the permission matrix. For every policy-checked endpoint and every role, the
server's answer must match what the policy registry declares.

This is generated from the URL configuration and the registry, so a new endpoint or a
changed grant is covered without editing this file.
"""

import pytest

from apps.core import policy
from apps.core.api.mixins import PolicyViewSetMixin
from apps.core.policy import Action
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from tests.test_permission_coverage import _api_views

pytestmark = pytest.mark.django_db

ROLES = [None, *Role]  # None: a staff user with no role at all


def _list_routes():
    routes = []
    for route, name, view_class in _api_views():
        if not (name or "").endswith("-list") or not issubclass(view_class, PolicyViewSetMixin):
            continue
        url = "/" + route.replace("^", "").replace("$", "")
        routes.append((url, view_class))
    return sorted(routes, key=lambda r: r[0])


LIST_ROUTES = _list_routes()


def test_the_matrix_covers_every_policy_endpoint():
    assert len(LIST_ROUTES) >= 20


@pytest.fixture
def users_by_role(make_user, tenant_a):
    users = {}
    for role in ROLES:
        name = f"matrix-{role or 'none'}"
        users[role] = make_user(name, tenant_a, [role] if role else [])
    return users


def _expected(user, tenant, resource_name, action) -> bool:
    with tenant_context(tenant.id, user.pk):
        subject = policy.subject_for(user, tenant.id)
        return policy.can(subject, policy.get_resource(resource_name), action)


def test_sec_02_every_role_on_every_list_endpoint(users_by_role, tenant_a, token_client):
    mismatches = []
    for role, user in users_by_role.items():
        client = token_client(user)
        for url, view_class in LIST_ROUTES:
            expected = _expected(user, tenant_a, view_class.policy_resource, Action.VIEW)
            status = client.get(url).status_code
            if (status == 200) != expected or status not in (200, 403):
                mismatches.append(
                    f"{role} GET {url}: {status}, expected {200 if expected else 403}"
                )
    assert not mismatches, "\n".join(mismatches)


def test_sec_02_every_role_on_every_create_endpoint(users_by_role, tenant_a, token_client):
    mismatches = []
    for role, user in users_by_role.items():
        client = token_client(user)
        for url, view_class in LIST_ROUTES:
            if "post" not in view_class.http_method_names or not hasattr(view_class, "create"):
                continue
            allowed = _expected(user, tenant_a, view_class.policy_resource, Action.CREATE)
            status = client.post(url, {}, format="json").status_code
            # Allowed roles get past authorisation (an empty body then fails validation).
            if allowed and status in (401, 403):
                mismatches.append(f"{role} POST {url}: {status}, expected to be allowed")
            if not allowed and status != 403:
                mismatches.append(f"{role} POST {url}: {status}, expected 403")
    assert not mismatches, "\n".join(mismatches)


def test_sec_02_every_endpoint_rejects_anonymous_callers(api_client):
    for url, _ in LIST_ROUTES:
        assert api_client.get(url).status_code == 401, url
