"""SEC-02: every API endpoint is covered by the policy layer, or is a listed exception."""

from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.views import APIView

from apps.core import policy
from apps.core.api.mixins import PolicyViewSetMixin
from apps.core.api.permissions import PolicyPermission, TenantUserPermission

# Endpoints that cannot use a policy resource, with the reason.
PORTAL = "PortalPermission: the patient is the one the signed-in user's portal account names"
NOT_POLICY_CHECKED = {
    "auth-login": "anonymous sign-in, throttled, CSRF-checked for sessions",
    "auth-csrf": "sets the CSRF cookie only, no data",
    "auth-password-reset": "anonymous, throttled, never reveals accounts",
    "auth-password-reset-confirm": "anonymous, needs a signed one-time token",
    "auth-logout": "acts only on the caller's own session or token",
    "auth-me": "returns only the caller's own profile",
    "break-glass-request": "TenantUserPermission plus business checks in the service",
    "break-glass-patient": "TenantUserPermission; reports only the caller's own access and grants",
    "reports-dashboard": "TenantUserPermission; each card checks tenant-wide view in the service",
    "api-schema": "API description only, no data; signed-in users (SERVE_PERMISSIONS)",
    "codes-loinc": "shared reference codes, no tenant data; TenantUserPermission",
    "codes-icd10": "shared reference codes, no tenant data; TenantUserPermission",
    "shift-clock-in": "acts only on the caller's own shift; TenantUserPermission",
    "shift-clock-out": "acts only on the caller's own shift; TenantUserPermission",
    "portal-home": PORTAL,
    "portal-appointments": PORTAL,
    "portal-slots": PORTAL,
    "portal-appointment-cancel": PORTAL,
    "portal-results": PORTAL,
    "portal-result-seen": PORTAL,
    "portal-prescriptions": PORTAL,
    "portal-invoices": PORTAL,
    "portal-profile": PORTAL,
}


def _api_views(patterns=None, prefix=""):
    for pattern in patterns if patterns is not None else get_resolver().url_patterns:
        if isinstance(pattern, URLResolver):
            yield from _api_views(pattern.url_patterns, prefix + str(pattern.pattern))
        elif isinstance(pattern, URLPattern):
            view_class = getattr(pattern.callback, "cls", None)
            if view_class and issubclass(view_class, APIView):
                yield prefix + str(pattern.pattern), pattern.name, view_class


def test_sec_02_every_api_view_uses_the_policy_permission():
    unchecked = []
    for route, name, view_class in _api_views():
        if PolicyPermission in view_class.permission_classes:
            assert issubclass(view_class, PolicyViewSetMixin), route
            continue
        if name not in NOT_POLICY_CHECKED:
            unchecked.append(f"{route} ({name})")
    assert not unchecked, "API views without PolicyPermission:\n" + "\n".join(unchecked)


def test_listed_exceptions_still_exist():
    names = {name for _, name, _ in _api_views()}
    assert set(NOT_POLICY_CHECKED) <= names


def test_break_glass_request_requires_a_verified_tenant_user():
    view_class = next(cls for _, name, cls in _api_views() if name == "break-glass-request")
    assert view_class.permission_classes == [TenantUserPermission]


def test_every_policy_view_names_a_registered_resource():
    registered = policy.registered_resources()
    for route, _, view_class in _api_views():
        if issubclass(view_class, PolicyViewSetMixin):
            assert view_class.policy_resource in registered, route
