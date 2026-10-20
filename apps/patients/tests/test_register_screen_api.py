"""The patients screen's API: live duplicate check, registration with allergies, and the
register's list fields, filters, sorting and paging (SEC-02, SEC-03, SEC-07)."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.patients.models import Allergy, DuplicateReview, Patient
from apps.scheduling.models import Appointment
from apps.tenants.models import Facility

from .conftest import ADA

pytestmark = pytest.mark.django_db

PATIENTS = "/api/patients/patients/"
CHECK = f"{PATIENTS}check-duplicates/"

PENICILLIN = {
    "substance": "Penicillin",
    "category": "medication",
    "reaction": "Hives and swelling",
    "severity": "severe",
}


def person(**overrides):
    return {
        "first_name": "Adaeze",
        "last_name": "Okonkwo",
        "date_of_birth": "1990-04-12",
        **overrides,
    }


# -- live duplicate check ---------------------------------------------------------------


def test_fr_duplicate_check_shows_possible_matches_below_the_hold_threshold(clerk, make_patient):
    exact = make_patient()
    # Same birthday, first name misspelt twice over: a hint, not enough to hold (85%).
    close = make_patient(first_name="Ngozi", last_name="Okonkwo")

    body = clerk.post(CHECK, person(), format="json").json()
    by_mrn = {row["mrn"]: row for row in body}
    assert by_mrn[exact.mrn]["would_hold"] is True and by_mrn[exact.mrn]["score"] > 0.85
    assert by_mrn[close.mrn]["would_hold"] is False and 0.6 < by_mrn[close.mrn]["score"] <= 0.85
    assert [row["score"] for row in body] == sorted((r["score"] for r in body), reverse=True)
    assert set(by_mrn[exact.mrn]) == {
        "patient_id",
        "mrn",
        "first_name",
        "last_name",
        "date_of_birth",
        "sex",
        "score",
        "would_hold",
    }


def test_duplicate_check_saves_nothing_and_finds_nothing_for_a_stranger(clerk, make_patient):
    make_patient()
    before = Patient.all_tenants.count()
    stranger = person(first_name="Zainab", last_name="Bello", date_of_birth="1975-01-30")
    assert clerk.post(CHECK, stranger, format="json").json() == []
    assert Patient.all_tenants.count() == before
    assert not DuplicateReview.all_tenants.exists()


def test_sec_03_duplicate_check_that_shows_other_patients_is_audited(clerk, make_patient):
    existing = make_patient()
    clerk.post(CHECK, person(), format="json")
    entry = AuditEntry.objects.get(action="read", resource="patients.patient")
    assert entry.details["object_ids"] == [str(existing.id)]
    assert entry.details["view_action"] == "check_duplicates"


def test_sec_02_duplicate_check_needs_the_right_to_register(make_user, tenant_a, signed_in):
    pharmacist = signed_in(make_user("pharm", tenant_a, [Role.PHARMACIST]))
    assert pharmacist.post(CHECK, person(), format="json").status_code == 403


def test_sec_07_duplicate_check_never_shows_another_tenants_patients(clerk, make_patient, tenant_b):
    make_patient(tenant=tenant_b)
    assert clerk.post(CHECK, person(), format="json").json() == []


def test_duplicate_check_validates_its_input(clerk):
    assert clerk.post(CHECK, {"first_name": "Ada"}, format="json").status_code == 400


# -- registration with allergies --------------------------------------------------------


def test_registration_saves_the_patient_and_allergies_together(doctor, tenant_a):
    response = doctor.post(PATIENTS, {**ADA, "allergies": [PENICILLIN]}, format="json")
    assert response.status_code == 201
    assert "allergies" not in response.json()
    allergy = Allergy.all_tenants.get()
    assert allergy.patient_id == Patient.all_tenants.get().id
    assert (allergy.substance, allergy.severity) == ("Penicillin", "severe")
    logged = AuditEntry.objects.get(action="create", resource="patients.allergy")
    assert logged.object_id == str(allergy.id)


def test_a_bad_allergy_saves_nothing(doctor):
    bad = {**PENICILLIN, "severity": "catastrophic"}
    response = doctor.post(PATIENTS, {**ADA, "allergies": [bad]}, format="json")
    assert response.status_code == 400
    assert not Patient.all_tenants.exists() and not Allergy.all_tenants.exists()


def test_sec_02_clerks_cannot_record_allergies_while_registering(clerk):
    response = clerk.post(PATIENTS, {**ADA, "allergies": [PENICILLIN]}, format="json")
    assert response.status_code == 403
    assert not Patient.all_tenants.exists()
    # Registering without allergies is still theirs to do.
    assert clerk.post(PATIENTS, ADA, format="json").status_code == 201


def test_held_registration_keeps_its_allergies_until_the_review_creates_the_patient(
    doctor, clerk, make_patient
):
    make_patient()
    held = doctor.post(PATIENTS, {**ADA, "phone": "", "allergies": [PENICILLIN]}, format="json")
    assert held.status_code == 409
    review = DuplicateReview.all_tenants.get()
    assert review.payload["allergies"][0]["substance"] == "Penicillin"
    assert not Allergy.all_tenants.exists()

    resolved = doctor.post(
        f"/api/patients/duplicate-reviews/{review.id}/resolve/",
        {"decision": "created_new", "note": "Twin, different person"},
        format="json",
    )
    assert resolved.status_code == 200
    created = Patient.all_tenants.get(id=resolved.json()["created_patient"])
    assert [a.substance for a in Allergy.all_tenants.filter(patient=created)] == ["Penicillin"]


# -- the register -----------------------------------------------------------------------


def test_list_rows_carry_active_allergies_but_not_entered_in_error_ones(doctor, make_patient):
    patient = make_patient()
    Allergy.all_tenants.create(tenant=patient.tenant, patient=patient, **PENICILLIN)
    Allergy.all_tenants.create(
        tenant=patient.tenant,
        patient=patient,
        record_state="entered_in_error",
        **{**PENICILLIN, "substance": "Peanuts"},
    )
    row = doctor.get(PATIENTS).json()["results"][0]
    assert row["allergies"] == [{"substance": "Penicillin", "severity": "severe"}]


def test_list_filters_by_status_and_allergy(doctor, make_patient):
    allergic = make_patient(first_name="Amaka", last_name="Eze")
    make_patient(first_name="Bola", last_name="Ade", date_of_birth="1980-02-02")
    Allergy.all_tenants.create(tenant=allergic.tenant, patient=allergic, **PENICILLIN)
    names = lambda url: [r["first_name"] for r in doctor.get(url).json()["results"]]  # noqa: E731
    assert names(f"{PATIENTS}?allergy=true") == ["Amaka"]
    assert sorted(names(f"{PATIENTS}?status=active")) == ["Amaka", "Bola"]
    assert names(f"{PATIENTS}?status=deceased") == []


def test_list_sorts_on_the_allowed_fields_and_ignores_others(doctor, make_patient):
    make_patient(first_name="Chidi", last_name="Zubairu", date_of_birth="1970-01-01")
    make_patient(first_name="Amaka", last_name="Abiola", date_of_birth="2000-01-01")
    last_names = lambda order: [  # noqa: E731
        r["last_name"] for r in doctor.get(f"{PATIENTS}?ordering={order}").json()["results"]
    ]
    assert last_names("name") == ["Abiola", "Zubairu"]
    assert last_names("-name") == ["Zubairu", "Abiola"]
    assert last_names("date_of_birth") == ["Zubairu", "Abiola"]
    assert len(last_names("password")) == 2  # unknown fields fall back, never error


def test_list_pages_by_the_requested_size(doctor, make_patient):
    for n in range(12):
        make_patient(first_name=f"Pat{'abcdefghijkl'[n]}", last_name="Page")
    body = doctor.get(f"{PATIENTS}?page_size=10").json()
    assert body["count"] == 12 and len(body["results"]) == 10 and body["next"]
    assert len(doctor.get(f"{PATIENTS}?page_size=500").json()["results"]) == 12


def test_list_query_count_does_not_grow_with_the_rows(doctor, make_patient):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    def add(count, offset):
        for n in range(count):
            patient = make_patient(first_name=f"Row{'abcdefghij'[offset + n]}", last_name="Query")
            Allergy.all_tenants.create(tenant=patient.tenant, patient=patient, **PENICILLIN)

    def queries():
        with CaptureQueriesContext(connection) as captured:
            assert doctor.get(PATIENTS).status_code == 200
        return len(captured)

    add(2, 0)
    queries()  # the first request also warms per-process caches
    few = queries()
    add(6, 2)
    assert queries() == few


def test_sec_02_last_visit_comes_only_from_appointments_the_user_may_view(
    clerk, make_user, tenant_a, signed_in, make_patient, as_tenant
):
    patient = make_patient()
    physician = make_user("phys", tenant_a, [Role.DOCTOR])
    start = timezone.now() - timedelta(days=3)
    with as_tenant(tenant_a):
        facility = Facility.objects.create(name="Main", code="main")
        for status, days in (("completed", 3), ("no_show", 1)):
            Appointment.objects.create(
                patient=patient,
                physician=physician,
                facility=facility,
                appointment_type="new",
                start_at=start + timedelta(days=3 - days),
                end_at=start + timedelta(days=3 - days, minutes=20),
                status=status,
            )
    # The clerk sees appointments tenant-wide: the attended visit counts, the no-show does not.
    row = clerk.get(PATIENTS).json()["results"][0]
    assert row["last_visit"] is not None
    assert row["last_visit"].startswith(start.date().isoformat())
    # A pharmacist may view patients but no appointments: nothing about visits is revealed.
    pharmacist = signed_in(make_user("pharm", tenant_a, [Role.PHARMACIST]))
    assert pharmacist.get(PATIENTS).json()["results"][0]["last_visit"] is None


def test_the_register_is_still_tenant_scoped(doctor, make_patient, tenant_b):
    make_patient(tenant=tenant_b)
    assert doctor.get(PATIENTS).json()["count"] == 0
