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
