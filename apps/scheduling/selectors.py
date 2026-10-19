"""Read-only queries that other modules may use."""

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
