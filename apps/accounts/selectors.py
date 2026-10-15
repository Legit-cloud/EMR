"""Read-only account queries used by the policy layer and other modules."""

import uuid

from django.conf import settings
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from apps.core.policy import Assignment

from .models import ApiToken, BreakGlassGrant, RoleAssignment


def role_assignments(user_id) -> list[Assignment]:
    """The user's role assignments in the current tenant."""
    rows = RoleAssignment.objects.filter(user_id=user_id).values_list(
        "role", "facility_id", "department_id"
    )
    return [
        Assignment(role, facility_id, department_id) for role, facility_id, department_id in rows
    ]


def roles_of(user_id) -> set[str]:
    return {a.role for a in role_assignments(user_id)}


def active_break_glass_grant_id(user_id, resource: str, object_id: str) -> uuid.UUID | None:
    return (
        BreakGlassGrant.objects.filter(
            user_id=user_id,
            resource=resource,
            object_id=object_id,
            expires_at__gt=timezone.now(),
        )
        .values_list("id", flat=True)
        .first()
    )


def confirmed_totp_device(user) -> TOTPDevice | None:
    return TOTPDevice.objects.filter(user=user, confirmed=True).first()


def mfa_required(user) -> bool:
    """MFA applies once a device is confirmed, and always for roles that must use it."""
    if confirmed_totp_device(user) is not None:
        return True
    return bool(roles_of(user.pk) & set(settings.MFA_REQUIRED_ROLES))


def is_mfa_verified(request) -> bool:
    if isinstance(request.auth, ApiToken):
        return request.auth.mfa_verified
    is_verified = getattr(request.user, "is_verified", None)
    return bool(is_verified and is_verified())


def emails_of_role_holders(roles) -> list[str]:
    """Email addresses of active users holding any of ``roles`` in the current tenant."""
    rows = (
        RoleAssignment.objects.filter(role__in=[str(r) for r in roles], user__is_active=True)
        .exclude(user__email="")
        .values_list("user__email", flat=True)
    )
    return sorted(set(rows))


def is_session_mfa_verified(session, user) -> bool:
    """MFA check for WebSocket connections, which do not pass through OTPMiddleware."""
    from django_otp import DEVICE_ID_SESSION_KEY
    from django_otp.models import Device

    persistent_id = (session or {}).get(DEVICE_ID_SESSION_KEY)
    if not persistent_id:
        return False
    device = Device.from_persistent_id(persistent_id)
    return device is not None and device.user_id == user.pk and device.confirmed
