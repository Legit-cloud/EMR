from rest_framework import exceptions
from rest_framework.permissions import BasePermission

from apps.accounts.selectors import is_mfa_verified, mfa_required
from apps.core import policy
from apps.core.errors import DomainError


class MFARequired(exceptions.PermissionDenied):
    default_detail = "Multi-factor authentication is required."
    default_code = "mfa_required"


class NoTenant(exceptions.PermissionDenied):
    default_detail = "This action needs an organisation account."
    default_code = "no_tenant"


class BreakGlassAvailable(DomainError):
    """This record is outside your normal access. You can open it with break-glass."""

    code = "break_glass_available"
    status_code = 403


def require_verified_tenant_user(request) -> None:
    """Shared gate: signed in, MFA satisfied, acting inside a tenant."""
    if not request.user or not request.user.is_authenticated:
        raise exceptions.NotAuthenticated()
    # Verified first: it is free for bearer tokens, and then mfa_required needs no query.
    if not is_mfa_verified(request) and mfa_required(request.user):
        raise MFARequired()
    if getattr(request, "tenant_id", None) is None:
        raise NoTenant()


class TenantUserPermission(BasePermission):
    """For tenant endpoints that do their own business checks (for example break-glass)."""

    def has_permission(self, request, view):
        require_verified_tenant_user(request)
        return True


class PolicyPermission(BasePermission):
    """RBAC + ABAC on every request (SEC-02), using the view's registered policy resource."""

    def has_permission(self, request, view):
        if request.method.lower() not in view.http_method_names or view.action is None:
            raise exceptions.MethodNotAllowed(request.method)
        require_verified_tenant_user(request)
        return policy.can(view.policy_subject(), view.get_policy_resource(), view.policy_action)

    def has_object_permission(self, request, view, obj):
        subject, resource = view.policy_subject(), view.get_policy_resource()
        decision = policy.check_object(
            subject, resource, view.policy_action, obj, view.get_base_queryset()
        )
        view.policy_decision = decision
        if (
            not decision.allowed
            and decision.reason == "out_of_scope"
            and resource.break_glass
            and view.policy_action == policy.Action.VIEW
            and subject.can_break_glass()
        ):
            patient_id = policy.patient_id_of(resource, obj)
            raise BreakGlassAvailable(
                details={"resource": policy.PATIENT_RESOURCE, "object_id": patient_id}
                if patient_id
                else {"resource": resource.name, "object_id": str(obj.pk)}
            )
        return decision.allowed
