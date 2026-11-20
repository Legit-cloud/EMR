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

from .models import (
    LeaveRequest,
    LeaveStatus,
    LicenceFlag,
    LicenceVerification,
    Shift,
    StaffProfile,
)


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


# -- leave -----------------------------------------------------------------------------------


class LeaveRefused(DomainError):
    code = "leave_refused"
    status_code = 400


def _open_leave(staff, start, end, exclude=None):
    found = LeaveRequest.objects.filter(
        staff=staff,
        status__in=[LeaveStatus.PENDING, LeaveStatus.APPROVED],
        start_date__lte=end,
        end_date__gte=start,
    )
    return found.exclude(pk=exclude.pk) if exclude else found


@transaction.atomic
def request_leave(user, *, leave_type, start_date, end_date, note: str = ""):
    """A staff member asks for time off for themselves."""
    profile = _profile_of(user)
    if end_date < start_date:
        raise LeaveRefused("The last day cannot be before the first day.")
    if start_date < timezone.localdate():
        raise LeaveRefused("Leave cannot start in the past.")
    if _open_leave(profile, start_date, end_date).exists():
        raise LeaveRefused("You already have leave requested or approved on those days.")
    return LeaveRequest.objects.create(
        staff=profile,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
        note=note.strip(),
    )


@transaction.atomic
def decide_leave(leave, *, approve: bool, decider, note: str = ""):
    """HR approves or rejects a pending request. Nobody decides their own."""
    leave = LeaveRequest.objects.select_for_update().get(pk=leave.pk)
    if leave.status != LeaveStatus.PENDING:
        raise LeaveRefused(f"This request is already {leave.get_status_display().lower()}.")
    if leave.staff.user_id == decider.pk:
        raise LeaveRefused("You cannot decide your own leave request.")
    if not approve and not note.strip():
        raise LeaveRefused("Say why the request is being rejected.")
    leave.status = LeaveStatus.APPROVED if approve else LeaveStatus.REJECTED
    leave.decided_by = decider
    leave.decided_at = timezone.now()
    leave.decision_note = note.strip()
    leave.save()
    _notify_leave_decision(leave)
    return leave


@transaction.atomic
def cancel_leave(leave, *, user):
    """The requester withdraws a pending request, or approved leave that has not started."""
    leave = LeaveRequest.objects.select_for_update().get(pk=leave.pk)
    if leave.staff.user_id != user.pk:
        raise LeaveRefused("Only the person who asked can cancel it.")
    if leave.status == LeaveStatus.PENDING or (
        leave.status == LeaveStatus.APPROVED and leave.start_date > timezone.localdate()
    ):
        leave.status = LeaveStatus.CANCELLED
        leave.save()
        return leave
    raise LeaveRefused("This leave can no longer be cancelled.")


def _notify_leave_decision(leave) -> None:
    address = leave.staff.user.email
    if not address:
        return
    notifications.queue_email(
        to=address,
        subject=f"Your leave request was {leave.get_status_display().lower()}",
        body=(
            f"Your {leave.get_leave_type_display().lower()} from {leave.start_date:%d %b %Y} "
            f"to {leave.end_date:%d %b %Y} was {leave.get_status_display().lower()}."
        ),
        purpose="leave_decision",
        related_object=f"leave:{leave.pk}",
    )
