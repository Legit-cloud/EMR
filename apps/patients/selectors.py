"""Read-only patient queries that other modules may use."""

from django.db.models import Q

from .models import Allergy, Patient, PatientStatus
from .normalize import name_key


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


def contact_details(patient_id) -> dict | None:
    """Name and contact channels for appointment messages."""
    return (
        Patient.objects.active_chart()
        .filter(pk=patient_id)
        .values("first_name", "last_name", "phone", "email")
        .first()
    )


def summaries(patient_ids) -> dict:
    """``{patient_id: {"name", "mrn"}}`` for lists such as the physician queue."""
    rows = Patient.objects.filter(pk__in=list(patient_ids)).values(
        "id", "first_name", "last_name", "mrn"
    )
    return {
        row["id"]: {"name": f"{row['first_name']} {row['last_name']}", "mrn": row["mrn"]}
        for row in rows
    }


def search_ids(text: str) -> list:
    """Ids of patients whose MRN, phone or name matches. Every word must match a name."""
    text = text.strip()[:100]
    if not text:
        return []
    words = name_key(text).split()
    names = Q()
    for word in words:
        names &= Q(first_name_key__icontains=word) | Q(last_name_key__icontains=word)
    return list(
        Patient.objects.filter(Q(mrn__iexact=text) | Q(phone=text) | names).values_list(
            "pk", flat=True
        )[:500]
    )


def registered_before_count(patient_ids, moment) -> int:
    """How many of these patients were registered before ``moment`` (returning patients)."""
    return Patient.objects.filter(pk__in=patient_ids, created_at__lt=moment).count()


def portal_profile(patient_id) -> dict | None:
    """What a patient may see and correct about themselves in the portal."""
    return (
        Patient.objects.filter(pk=patient_id)
        .values("first_name", "last_name", "mrn", "date_of_birth", "phone", "email")
        .first()
    )
