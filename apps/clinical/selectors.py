"""Read-only clinical queries that other modules may use."""

from .models import ClinicalStatus, Diagnosis, Observation, VerificationStatus


def active_problem_list(patient_id) -> list[dict]:
    """Diagnoses on the active chart that are current and not refuted."""
    return list(
        Diagnosis.objects.active_chart()
        .filter(
            patient_id=patient_id,
            clinical_status__in=[ClinicalStatus.ACTIVE, ClinicalStatus.RECURRENCE],
        )
        .exclude(verification_status=VerificationStatus.REFUTED)
        .order_by("code")
        .values("id", "code_system", "code", "display", "clinical_status", "verification_status")
    )


def latest_observation(patient_id, loinc_code: str) -> dict | None:
    """Most recent active reading of one LOINC code (for example weight for dosing)."""
    return (
        Observation.objects.filter(
            code_id=loinc_code,
            vital_signs__patient_id=patient_id,
            vital_signs__record_state="active",
        )
        .order_by("-vital_signs__recorded_at")
        .values("value", "unit", "vital_signs__recorded_at")
        .first()
    )
