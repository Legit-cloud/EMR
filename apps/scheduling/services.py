"""Appointments: booking, the seven-state lifecycle, the OPD queue and reminders."""

import logging
import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, transaction
from django.utils import timezone

from apps.clinical import services as clinical
from apps.core import events
from apps.core.errors import DomainError
from apps.core.tenancy import get_current_tenant_id, get_current_user_id
from apps.notifications import services as notifications
from apps.patients import selectors as patients
from apps.staff import selectors as staff

from .events import APPOINTMENT_COMPLETED
from .ics import build_ics
from .models import (
    HOLDING_STATUSES,
    TRANSITIONS,
    Appointment,
    AppointmentReminder,
    AppointmentStatus,
    AppointmentType,
    AvailabilityWindow,
)

logger = logging.getLogger(__name__)
S = AppointmentStatus
ACTIVE_FOR_PATIENT = [S.BOOKED, S.CONFIRMED, S.CHECKED_IN]
DEFAULT_TRIAGE = {AppointmentType.EMERGENCY: 1}
DEADLOCK_DETECTED = "40P01"
RECURRENCE_STEP = {"daily": timedelta(days=1), "weekly": timedelta(weeks=1)}


class SlotTaken(DomainError):
    """The physician already has an appointment at this time."""

    code = "slot_taken"
    status_code = 409


class TransitionRefused(DomainError):
    code = "transition_refused"
    status_code = 409


# -- booking -------------------------------------------------------------------------


def _local(moment):
    return moment.astimezone(ZoneInfo(settings.MRN_TIME_ZONE))


def _check_bookable(appointment: Appointment) -> None:
    if patients.contact_details(appointment.patient_id) is None:
        raise ValidationError({"patient": "Patient not found."})
    if patients.is_deceased(appointment.patient_id):
        raise ValidationError({"patient": "The patient is recorded as deceased."})
    if staff.physician(appointment.physician_id) is None:
        raise ValidationError({"physician": "Choose an active physician of this organisation."})
    if appointment.appointment_type == AppointmentType.EMERGENCY:
        return
    if appointment.start_at < timezone.now():
        raise ValidationError({"start_at": "Cannot book in the past."})
    inside_window = AvailabilityWindow.objects.filter(
        physician_id=appointment.physician_id,
        start_at__lte=appointment.start_at,
        end_at__gte=appointment.end_at,
    ).exists()
    if not inside_window:
        raise ValidationError({"start_at": "The physician is not available at this time."})


def _save_new(appointment: Appointment) -> None:
    appointment._assign_tenant()
    _check_bookable(appointment)
    _persist(appointment)


def _persist(appointment: Appointment) -> None:
    """Validate and save, turning every way of losing the slot into ``SlotTaken``."""
    try:
        # Model validation reports overlaps nicely; the database constraint is what makes
        # simultaneous bookings safe.
        appointment.full_clean(exclude=["created_by", "updated_by"])
        with transaction.atomic():
            appointment.save()
    except ValidationError as exc:
        if "__all__" in exc.message_dict and any(
            "already has an appointment" in m for m in exc.message_dict["__all__"]
        ):
            raise SlotTaken(details={"start_at": appointment.start_at.isoformat()}) from None
        raise
    except IntegrityError as exc:
        if "no_double_booking" in str(exc):
            raise SlotTaken(details={"start_at": appointment.start_at.isoformat()}) from None
        raise
    except OperationalError as exc:
        # Simultaneous inserts that collide on an exclusion constraint can deadlock;
        # PostgreSQL aborts one of them. That booking did collide, so the slot is taken.
        if getattr(exc.__cause__, "sqlstate", None) == DEADLOCK_DETECTED:
            raise SlotTaken(details={"start_at": appointment.start_at.isoformat()}) from None
        raise


@transaction.atomic
def book(data: dict, *, recurrence: dict | None = None) -> list[Appointment]:
    """Book one appointment, or a recurring series (all or nothing). Sends confirmations."""
    data = dict(data)
    if not data.get("end_at"):
        data["end_at"] = data["start_at"] + timedelta(minutes=settings.APPOINTMENT_SLOT_MINUTES)
    count, step = 1, None
    if recurrence:
        count, step = recurrence["count"], RECURRENCE_STEP[recurrence["frequency"]]
    series_id = uuid.uuid4() if count > 1 else None
    booked = []
    for i in range(count):
        offset = step * i if step else timedelta(0)
        appointment = Appointment(
            **{**data, "start_at": data["start_at"] + offset, "end_at": data["end_at"] + offset},
            series_id=series_id,
        )
        _save_new(appointment)
        booked.append(appointment)
    for appointment in booked:
        send_booking_confirmation(appointment)
    return booked


@transaction.atomic
def reschedule(
    appointment: Appointment,
    start_at: datetime,
    *,
    end_at: datetime | None = None,
    physician_id=None,
) -> Appointment:
    """Move an appointment that has not started, to another time and/or physician.

    The same rules as booking apply (open window, nobody else booked, not in the past), and
    the database constraint still decides simultaneous moves. The length is kept unless a new
    end is given. The patient is told the new time, and reminders start again for it.
    """
    appointment = Appointment.objects.select_for_update().get(pk=appointment.pk)
    if appointment.status not in (S.BOOKED, S.CONFIRMED):
        raise TransitionRefused("Only an appointment that has not started can be moved.")
    length = appointment.end_at - appointment.start_at
    appointment.start_at = start_at
    appointment.end_at = end_at or start_at + length
    if physician_id is not None:
        appointment.physician_id = physician_id
    _check_bookable(appointment)
    _persist(appointment)
    # Reminders sent for the old time must not stop the ones for the new time.
    appointment.reminders.all().delete()
    send_booking_confirmation(appointment, moved=True)
    return appointment


def free_slots(physician_id, day) -> list[dict]:
    """Open slots of ``APPOINTMENT_SLOT_MINUTES`` in the physician's windows on ``day``."""
    zone = ZoneInfo(settings.MRN_TIME_ZONE)
    day_start = datetime.combine(day, time.min, tzinfo=zone)
    day_end = day_start + timedelta(days=1)
    length = timedelta(minutes=settings.APPOINTMENT_SLOT_MINUTES)
    busy = list(
        Appointment.objects.filter(
            physician_id=physician_id,
            status__in=HOLDING_STATUSES,
            start_at__lt=day_end,
            end_at__gt=day_start,
        )
        .exclude(appointment_type=AppointmentType.EMERGENCY)
        .values_list("start_at", "end_at")
    )
    now = timezone.now()
    slots = []
    windows = AvailabilityWindow.objects.filter(
        physician_id=physician_id, start_at__lt=day_end, end_at__gt=day_start
    )
    for window in windows:
        cursor = max(window.start_at, day_start)
        while cursor + length <= min(window.end_at, day_end):
            end = cursor + length
            taken = any(start < end and cursor < finish for start, finish in busy)
            if not taken and cursor >= now:
                slots.append(
                    {
                        "start_at": cursor,
                        "end_at": end,
                        "facility": window.facility_id,
                        "department": window.department_id,
                    }
                )
            cursor = end
    return slots


# -- lifecycle -----------------------------------------------------------------------


@transaction.atomic
def change_status(
    appointment: Appointment,
    status: str,
    *,
    cancellation_reason: str = "",
    triage_priority: int | None = None,
) -> Appointment:
    appointment = Appointment.objects.select_for_update().get(pk=appointment.pk)
    if status not in TRANSITIONS[appointment.status]:
        raise TransitionRefused(f"Cannot change from {appointment.status} to {status}.")
    now = timezone.now()
    if status == S.CANCELLED:
        if not cancellation_reason.strip():
            raise ValidationError({"cancellation_reason": "Give a reason for the cancellation."})
        appointment.cancellation_reason = cancellation_reason.strip()
        appointment.cancelled_at = now
    elif status == S.NO_SHOW and appointment.start_at > now:
        raise TransitionRefused("An appointment cannot be a no-show before it starts.")
    elif status == S.CHECKED_IN:
        appointment.checked_in_at = now
        appointment.checked_in_by_id = get_current_user_id()
        appointment.triage_priority = triage_priority or DEFAULT_TRIAGE.get(
            appointment.appointment_type, settings.APPOINTMENT_DEFAULT_TRIAGE_PRIORITY
        )
    elif status == S.IN_CONSULTATION:
        appointment.consultation_started_at = now
        encounter = clinical.open_encounter_for_appointment(
            patient_id=appointment.patient_id,
            facility_id=appointment.facility_id,
            department_id=appointment.department_id,
            practitioner_id=appointment.physician_id,
            appointment_id=appointment.pk,
        )
        appointment.encounter_id = encounter.pk
    elif status == S.COMPLETED:
        appointment.completed_at = now
        if appointment.encounter_id:
            clinical.finish_encounter(appointment.encounter_id)
        events.publish(APPOINTMENT_COMPLETED, {"appointment_id": str(appointment.pk)})
    appointment.status = status
    appointment.full_clean(exclude=["created_by", "updated_by"], validate_constraints=False)
    appointment.save()
    if status in (S.CHECKED_IN, S.IN_CONSULTATION, S.CANCELLED) or (
        appointment.checked_in_at and status == S.COMPLETED
    ):
        _broadcast_after_commit(appointment.physician_id)
    return appointment


@transaction.atomic
def set_triage_priority(appointment: Appointment, priority: int) -> Appointment:
    if appointment.status != S.CHECKED_IN:
        raise TransitionRefused("Triage applies to checked-in patients.")
    appointment.triage_priority = priority
    appointment.full_clean(exclude=["created_by", "updated_by"], validate_constraints=False)
    appointment.save(update_fields=["triage_priority", "updated_at", "updated_by"])
    _broadcast_after_commit(appointment.physician_id)
    return appointment


def cancel_for_deceased_patient(patient_id) -> int:
    """Cancel every active appointment of the patient, recurring ones included."""
    cancelled = 0
    for appointment in Appointment.objects.filter(
        patient_id=patient_id, status__in=ACTIVE_FOR_PATIENT
    ):
        change_status(appointment, S.CANCELLED, cancellation_reason="Patient deceased")
        cancelled += 1
    return cancelled


# -- the OPD queue -------------------------------------------------------------------


def queue_group(tenant_id, physician_id) -> str:
    return f"queue.{tenant_id}.{physician_id}"


def queue_for(physician_id, scope=None) -> list[dict]:
    """Checked-in patients waiting for the physician: most urgent first, then by arrival.

    ``scope`` is the viewer's policy filter; rows outside it are left out.
    """
    waiting = Appointment.objects.filter(physician_id=physician_id, status=S.CHECKED_IN)
    if scope is not None:
        waiting = waiting.filter(scope)
    waiting = list(waiting.order_by("triage_priority", "checked_in_at"))
    names = patients.summaries(a.patient_id for a in waiting)
    return [
        {
            "appointment_id": str(a.pk),
            "patient_id": str(a.patient_id),
            "patient_name": names.get(a.patient_id, {}).get("name", ""),
            "mrn": names.get(a.patient_id, {}).get("mrn", ""),
            "appointment_type": a.appointment_type,
            "reason": a.reason,
            "triage_priority": a.triage_priority,
            "checked_in_at": a.checked_in_at.isoformat(),
            "start_at": a.start_at.isoformat(),
        }
        for a in waiting
    ]


def broadcast_queue(tenant_id, physician_id) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    # Only a signal: each connection reloads the queue under its own access scope.
    message = {"type": "queue.update"}
    async_to_sync(layer.group_send)(queue_group(tenant_id, physician_id), message)


def _broadcast_after_commit(physician_id) -> None:
    tenant_id = get_current_tenant_id()

    def send():
        from apps.core.tenancy import tenant_context

        try:
            with tenant_context(tenant_id):
                broadcast_queue(tenant_id, physician_id)
        except Exception:
            # The queue view also refreshes over HTTP; a missed push must not fail the request.
            logger.exception("Queue broadcast failed for physician %s", physician_id)

    transaction.on_commit(send)


# -- messages ------------------------------------------------------------------------


def _message_parts(appointment: Appointment) -> tuple[dict | None, str, str]:
    contact = patients.contact_details(appointment.patient_id)
    physician = staff.physician(appointment.physician_id)
    when = _local(appointment.start_at).strftime("%a %d %b %Y, %H:%M")
    return contact, (physician or {}).get("display_name", "your doctor"), when


def send_booking_confirmation(appointment: Appointment, *, moved: bool = False) -> None:
    """Tell the patient the time, with a calendar file. ``moved`` words it as a change."""
    contact, doctor, when = _message_parts(appointment)
    if contact is None:
        return
    reference = str(appointment.pk)[:8].upper()
    related = f"scheduling.appointment:{appointment.pk}"
    purpose = "appointment_rescheduled" if moved else "appointment_booked"
    if contact["email"]:
        invite = build_ics(
            uid=f"{appointment.pk}@{settings.ICS_UID_DOMAIN}",
            start=appointment.start_at,
            end=appointment.end_at,
            summary=f"Appointment with {doctor}",
            location=str(appointment.facility),
            description=f"Reference {reference}",
        )
        state = "now" if moved else "booked"
        notifications.queue_email(
            to=contact["email"],
            subject=f"Appointment {'moved' if moved else 'confirmed'}: {when}",
            body=(
                f"Dear {contact['first_name']},\n\nYour appointment with {doctor} is {state} "
                f"for {when} at {appointment.facility}.\nReference: {reference}\n"
            ),
            purpose=purpose,
            related_object=related,
            attachments=[("appointment.ics", invite, "text/calendar")],
        )


def send_due_reminders(now=None) -> int:
    """Send reminders at each configured offset before the start, once per offset.

    When several offsets are already due (a late booking), one reminder is sent and all
    of them are recorded. Returns the number of reminders sent.
    """
    now = now or timezone.now()
    offsets = sorted(settings.APPOINTMENT_REMINDER_OFFSETS_HOURS)
    horizon = now + timedelta(hours=max(offsets))
    sent = 0
    upcoming = Appointment.objects.filter(
        status__in=[S.BOOKED, S.CONFIRMED], start_at__gt=now, start_at__lte=horizon
    ).prefetch_related("reminders")
    for appointment in upcoming:
        done = {r.offset_hours for r in appointment.reminders.all()}
        due = [o for o in offsets if appointment.start_at - now <= timedelta(hours=o)]
        pending = [o for o in due if o not in done]
        if not pending:
            continue
        with transaction.atomic():
            try:
                for offset in pending:
                    AppointmentReminder.objects.create(
                        appointment=appointment, offset_hours=offset, sent_at=now
                    )
            except IntegrityError:
                continue  # another worker got there first
            _send_reminder(appointment)
        sent += 1
    return sent


def _send_reminder(appointment: Appointment) -> None:
    contact, doctor, when = _message_parts(appointment)
    if contact is None:
        return
    related = f"scheduling.appointment:{appointment.pk}"
    text = f"Reminder: appointment with {doctor} on {when}."
    if contact["email"]:
        notifications.queue_email(
            to=contact["email"],
            subject=f"Reminder: appointment on {when}",
            body=text,
            purpose="appointment_reminder",
            related_object=related,
        )


# -- self-service for the patient portal ---------------------------------------------------


class PortalNotFound(DomainError):
    code = "not_found"
    status_code = 404


class PortalRefused(DomainError):
    code = "portal_refused"
    status_code = 409


def can_patient_cancel(appointment: Appointment, now=None) -> bool:
    """A patient may cancel online while the visit is booked or confirmed and not too close."""
    now = now or timezone.now()
    if appointment.status not in (S.BOOKED, S.CONFIRMED):
        return False
    return appointment.start_at - now >= timedelta(hours=settings.PORTAL_CANCEL_MIN_HOURS)


def slot_id(physician_id, start_at) -> str:
    return f"{physician_id}_{int(start_at.timestamp())}"


def portal_open_slots(days: int | None = None, limit: int = 30) -> list[dict]:
    """The next free slots across all physicians who take bookings, soonest first."""
    from apps.staff import selectors as staff_selectors

    days = days or settings.PORTAL_BOOKING_DAYS
    zone = ZoneInfo(settings.MRN_TIME_ZONE)
    today = timezone.now().astimezone(zone).date()
    last = datetime.combine(today + timedelta(days=days + 1), time.min, tzinfo=zone)
    physicians = (
        AvailabilityWindow.objects.filter(end_at__gt=timezone.now(), start_at__lt=last)
        .values_list("physician_id", flat=True)
        .distinct()
    )
    found = []
    for physician_id in physicians:
        doctor = staff_selectors.physician(physician_id)
        if doctor is None:
            continue
        for offset in range(days + 1):
            for slot in free_slots(physician_id, today + timedelta(days=offset)):
                found.append(
                    {
                        "id": slot_id(physician_id, slot["start_at"]),
                        "doctor_name": doctor["display_name"],
                        "specialty": doctor["specialty"],
                        "start_at": slot["start_at"],
                        "end_at": slot["end_at"],
                    }
                )
    return sorted(found, key=lambda s: s["start_at"])[:limit]


@transaction.atomic
def book_for_patient(patient_id, *, slot: str, reason: str) -> Appointment:
    """Book a free slot for the patient themselves. The slot must still be free."""
    reason = reason.strip()
    if len(reason) < 3:
        raise PortalRefused("Tell us briefly why you are coming.")
    if patients.is_deceased(patient_id):
        raise PortalRefused("This account cannot book visits.")
    try:
        physician_id, stamp = slot.rsplit("_", 1)
        start_at = datetime.fromtimestamp(int(stamp), tz=ZoneInfo("UTC"))
        uuid.UUID(physician_id)
    except (ValueError, OverflowError):
        raise PortalRefused("That time is not available. Choose another.") from None
    upcoming = Appointment.objects.filter(
        patient_id=patient_id, status__in=[S.BOOKED, S.CONFIRMED], start_at__gte=timezone.now()
    ).count()
    if upcoming >= settings.PORTAL_MAX_UPCOMING_VISITS:
        raise PortalRefused(
            f"You already have {upcoming} visits booked. Cancel one or call us to book more."
        )
    day = start_at.astimezone(ZoneInfo(settings.MRN_TIME_ZONE)).date()
    match = next(
        (s for s in free_slots(physician_id, day) if s["start_at"] == start_at),
        None,
    )
    if match is None:
        raise SlotTaken("That time has just been taken. Choose another.")
    (appointment,) = book(
        {
            "patient_id": patient_id,
            "physician_id": physician_id,
            "facility_id": match["facility"],
            "department_id": match["department"],
            "appointment_type": "new",
            "start_at": match["start_at"],
            "end_at": match["end_at"],
            "reason": reason[:500],
        }
    )
    return appointment


@transaction.atomic
def cancel_for_patient(appointment_id, patient_id, reason: str) -> Appointment:
    """The patient cancels their own visit. Someone else's visit is simply not found."""
    appointment = Appointment.objects.filter(pk=appointment_id, patient_id=patient_id).first()
    if appointment is None:
        raise PortalNotFound("Not found.")
    if not reason.strip():
        raise PortalRefused("Tell us why you are cancelling.")
    if not can_patient_cancel(appointment):
        raise PortalRefused("This visit can no longer be cancelled online. Please call us.")
    return change_status(
        appointment,
        S.CANCELLED,
        cancellation_reason=f"Cancelled by the patient: {reason.strip()}"[:500],
    )
