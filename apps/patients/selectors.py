"""Read-only patient queries that other modules may use."""

from .models import Allergy, Patient, PatientStatus


def patient_exists(patient_id) -> bool:
    return Patient.objects.active_chart().filter(pk=patient_id).exists()


def is_deceased(patient_id) -> bool:
    return Patient.objects.filter(pk=patient_id, status=PatientStatus.DECEASED).exists()


def active_allergies(patient_id) -> list[dict]:
    """Allergies on the active chart, for the prescription allergy check."""
    return list(
        Allergy.objects.active_chart()
        .filter(patient_id=patient_id)
        .values("id", "substance", "substance_code", "category", "reaction", "severity")
    )
