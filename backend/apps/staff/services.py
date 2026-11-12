"""Staff operations: shifts, licence verification and the licence watcher."""

from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts import selectors as accounts
from apps.audit import services as audit
from apps.core.errors import DomainError
from apps.core.roles import Role
from apps.notifications import services as notifications

from .models import LicenceFlag, LicenceVerification, Shift, StaffProfile


class ShiftError(DomainError):
    code = "shift_error"
    status_code = 409


def _profile_of(user) -> StaffProfile:
    profile = StaffProfile.objects.filter(user=user).first()
    if profile is None:
        raise ShiftError("You have no staff profile in this organisation.")
    return profile


def clock_in(user) -> Shift:
    profile = _profile_of(user)
    try:
        with transaction.atomic():
            return Shift.objects.create(staff=profile, started_at=timezone.now())
    except IntegrityError:
        raise ShiftError("You are already on duty.") from None


def clock_out(user) -> Shift:
    profile = _profile_of(user)
    shift = Shift.objects.filter(staff=profile, ended_at__isnull=True).first()
    if shift is None:
        raise ShiftError("You are not on duty.")
    shift.ended_at = timezone.now()
    shift.save(update_fields=["ended_at", "updated_at", "updated_by"])
    return shift


@transaction.atomic
def record_licence_verification(
    profile: StaffProfile, *, outcome: str, reference: str, verified_by
) -> StaffProfile:
    """Record a check against the council register, done by a person for now.

    No council offers an API we can call yet; this stores who checked, when and the
    register reference so it can be shown to auditors.
    """
    if outcome not in (LicenceVerification.VERIFIED, LicenceVerification.REJECTED):
        raise DomainError("Outcome must be verified or rejected.")
    if not reference.strip():
        raise DomainError("Give the register reference.", details={"reference": ["Required."]})
    profile.licence_verification = outcome
    profile.licence_verified_by = verified_by
    profile.licence_verified_at = timezone.now()
    profile.licence_verification_reference = reference.strip()
    profile.save()
    return profile


def licence_flag_for(expires_on, today) -> str:
    if expires_on is None:
        return LicenceFlag.OK
    if expires_on < today:
        return LicenceFlag.EXPIRED
    if expires_on <= today + timedelta(days=settings.LICENCE_EXPIRY_WARNING_DAYS):
        return LicenceFlag.EXPIRING
    return LicenceFlag.OK


def watch_licences() -> list[StaffProfile]:
    """Flag licences that expire soon or have expired, in the current tenant.

    Notifies HR and tenant admins once per change of flag. Returns the newly flagged
    profiles. Safe to run repeatedly.
    """
    today = timezone.localdate()
    changed = []
    for profile in StaffProfile.objects.exclude(licence_expires_on=None).select_related("user"):
        flag = licence_flag_for(profile.licence_expires_on, today)
        if flag == profile.licence_flag:
            continue
        StaffProfile.objects.filter(pk=profile.pk).update(
            licence_flag=flag, licence_flagged_at=timezone.now()
        )
        audit.record(
            action=audit.AuditAction.UPDATE,
            resource="staff.staffprofile",
            object_id=profile.pk,
            reason="licence_watcher",
            details={"licence_flag": flag},
        )
        if flag != LicenceFlag.OK:
            profile.licence_flag = flag
            changed.append(profile)
            _notify_licence(profile)
    return changed


def _notify_licence(profile: StaffProfile) -> None:
    state = "has expired" if profile.licence_flag == LicenceFlag.EXPIRED else "expires soon"
    subject = f"Licence {state}: {profile}"
    body = (
        f"The {profile.get_licensing_body_display()} licence of {profile} {state} "
        f"(expiry {profile.licence_expires_on:%d %B %Y}). Please follow up on renewal."
    )
    for email in accounts.emails_of_role_holders({Role.HR, Role.TENANT_ADMIN}):
        notifications.queue_email(
            to=email,
            subject=subject,
            body=body,
            purpose="licence_watch",
            related_object=f"staff.staffprofile:{profile.pk}",
        )
