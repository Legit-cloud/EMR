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
                slots.append({"start_at": cursor, "end_at": end, "facility": window.facility_id})
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


def send_booking_confirmation(appointment: Appointment) -> None:
    contact, doctor, when = _message_parts(appointment)
    if contact is None:
        return
    reference = str(appointment.pk)[:8].upper()
    related = f"scheduling.appointment:{appointment.pk}"
    if contact["phone"]:
        notifications.queue_sms(
            to=contact["phone"],
            body=f"Appointment booked with {doctor} on {when}. Ref {reference}.",
            purpose="appointment_booked",
            related_object=related,
        )
    if contact["email"]:
        invite = build_ics(
            uid=f"{appointment.pk}@{settings.ICS_UID_DOMAIN}",
            start=appointment.start_at,
            end=appointment.end_at,
            summary=f"Appointment with {doctor}",
            location=str(appointment.facility),
            description=f"Reference {reference}",
        )
        notifications.queue_email(
            to=contact["email"],
            subject=f"Appointment confirmed: {when}",
            body=(
                f"Dear {contact['first_name']},\n\nYour appointment with {doctor} is booked "
                f"for {when} at {appointment.facility}.\nReference: {reference}\n"
            ),
            purpose="appointment_booked",
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
    if contact["phone"]:
        notifications.queue_sms(
            to=contact["phone"], body=text, purpose="appointment_reminder", related_object=related
        )
    if contact["email"]:
        notifications.queue_email(
            to=contact["email"],
            subject=f"Reminder: appointment on {when}",
            body=text,
            purpose="appointment_reminder",
            related_object=related,
        )
