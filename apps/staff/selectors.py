"""Read-only staff queries that other modules may use."""

from .models import Shift, StaffProfile, StaffType


def is_on_duty(user_id) -> bool:
    """Shift status for the policy layer: On-Duty while a shift is open."""
    return Shift.objects.filter(staff__user_id=user_id, ended_at__isnull=True).exists()


def physician(user_id) -> dict | None:
    """The physician's booking details, or None if the user is not an active physician."""
    profile = (
        StaffProfile.objects.select_related("user")
        .filter(user_id=user_id, staff_type=StaffType.PHYSICIAN, user__is_active=True)
        .first()
    )
    if profile is None:
        return None
    return {
        "user_id": profile.user_id,
        "display_name": str(profile),
        "consultation_fee": profile.consultation_fee,
        "licence_flag": profile.licence_flag,
    }


def licence_expiry(user_id):
    """The date the user's practising licence expires, or None if none is recorded."""
    return (
        StaffProfile.objects.filter(user_id=user_id)
        .values_list("licence_expires_on", flat=True)
        .first()
    )
