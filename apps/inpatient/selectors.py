"""Read-only queries that other modules, and the ward board, may use."""

from apps.patients import selectors as patients

from .models import Admission, Bed, Ward


def open_admission_count() -> int:
    return Admission.objects.filter(discharged_at__isnull=True).count()


def board():
    """Active wards with their beds, each bed with the open admission in it (if any).

    Returns ``(wards, occupants)``: occupants maps a bed id to its admission, with the
    patient's name and MRN from the patients module (never queried here directly).
    """
    wards = list(Ward.objects.filter(active=True).select_related("facility"))
    beds = list(Bed.objects.filter(ward__in=wards).select_related("ward").order_by("label"))
    by_ward: dict = {}
    for bed in beds:
        by_ward.setdefault(bed.ward_id, []).append(bed)
    for ward in wards:
        ward.board_beds = by_ward.get(ward.pk, [])
    admissions = list(Admission.objects.filter(discharged_at__isnull=True))
    names = patients.summaries({a.patient_id for a in admissions})
    occupants = {}
    for admission in admissions:
        admission.patient_name = names.get(admission.patient_id, {}).get("name", "")
        admission.patient_mrn = names.get(admission.patient_id, {}).get("mrn", "")
        occupants[admission.bed_id] = admission
    return wards, occupants


def names_for(patient_ids) -> dict:
    """``{patient_id: {"name", "mrn"}}`` from the patients module."""
    return patients.summaries(patient_ids)
