"""Read-only queries that other modules may use."""

from django.db.models import Max

from .models import Appointment, AppointmentStatus

# Visits that actually happened: the patient arrived.
ATTENDED = (
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_CONSULTATION,
    AppointmentStatus.COMPLETED,
)


def attended_patient_ids(start, end) -> set:
    """Patients with at least one attended visit starting in [start, end)."""
    return set(
        Appointment.objects.filter(start_at__gte=start, start_at__lt=end, status__in=ATTENDED)
        .values_list("patient_id", flat=True)
        .distinct()
    )


def last_visits(patient_ids, scope=None) -> dict:
    """Start time of each patient's latest attended visit, as {patient id: datetime}.

    ``scope`` is the caller's view filter on appointments (a Q); pass the policy's filter so
    a user never learns of visits they could not open. Patients with no visit are absent.
    """
    visits = Appointment.objects.filter(patient_id__in=patient_ids, status__in=ATTENDED)
    if scope is not None:
        visits = visits.filter(scope)
    return dict(
        visits.values("patient_id").annotate(last=Max("start_at")).values_list("patient_id", "last")
    )


def patient_appointments(patient_id) -> list[dict]:
    """The patient's own appointments, soonest upcoming first and then the past, for the portal."""
    from django.utils import timezone

    from apps.staff import selectors as staff

    from .services import can_patient_cancel

    now = timezone.now()
    names: dict = {}
    rows = []
    for a in Appointment.objects.filter(patient_id=patient_id).select_related("facility"):
        if a.physician_id not in names:
            names[a.physician_id] = staff.physician(a.physician_id) or {}
        doctor = names[a.physician_id]
        rows.append(
            {
                "id": a.pk,
                "doctor_name": doctor.get("display_name", "Your doctor"),
                "specialty": doctor.get("specialty", ""),
                "location": a.facility.name,
                "start_at": a.start_at,
                "end_at": a.end_at,
                "status": a.status,
                "reason": a.reason,
                "can_cancel": can_patient_cancel(a, now),
            }
        )
    upcoming = sorted((r for r in rows if r["start_at"] >= now), key=lambda r: r["start_at"])
    past = sorted(
        (r for r in rows if r["start_at"] < now), key=lambda r: r["start_at"], reverse=True
    )
    return upcoming + past
