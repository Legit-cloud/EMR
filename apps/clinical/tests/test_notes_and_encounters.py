"""Consultation notes (open/closed, addenda), encounters, access scopes and reference codes."""

from datetime import date

import pytest

from apps.core.roles import Role
from apps.patients.models import Patient

pytestmark = pytest.mark.django_db

NOTES = "/api/clinical/notes/"
ENCOUNTERS = "/api/clinical/encounters/"


@pytest.fixture
def note(doctor, encounter):
    response = doctor.post(
        NOTES,
        {"encounter": str(encounter.pk), "subjective": "Fever for 3 days", "plan": "Malaria RDT"},
        format="json",
    )
    assert response.status_code == 201, response.json()
    return response.json()


# -- notes ---------------------------------------------------------------------------


def test_author_edits_an_open_note_then_closes_it(doctor, note, doctor_user):
    url = f"{NOTES}{note['id']}/"
    assert note["status"] == "open" and note["author"] == str(doctor_user.pk)
    assert doctor.patch(url, {"assessment": "Likely malaria"}, format="json").status_code == 200
    closed = doctor.post(f"{url}close/").json()
    assert closed["status"] == "closed" and closed["closed_at"]


def test_closed_note_is_locked(doctor, note):
    url = f"{NOTES}{note['id']}/"
    doctor.post(f"{url}close/")
    response = doctor.patch(url, {"plan": "changed"}, format="json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "note_locked"
    assert doctor.post(f"{url}close/").status_code == 409


def test_only_the_author_edits_an_open_note(note, make_user, tenant_a, org, signed_in):
    colleague = signed_in(
        make_user("colleague", tenant_a, [Role.DOCTOR], department=org["medicine"])
    )
    response = colleague.patch(f"{NOTES}{note['id']}/", {"plan": "mine now"}, format="json")
    assert response.status_code == 409


def test_corrections_go_in_an_addendum_to_a_closed_note(doctor, note, encounter):
    open_addendum = doctor.post(
        NOTES,
        {"encounter": str(encounter.pk), "addendum_to": note["id"], "plan": "x"},
        format="json",
    )
    assert open_addendum.status_code == 400  # the original is still open
    doctor.post(f"{NOTES}{note['id']}/close/")
    addendum = doctor.post(
        NOTES,
        {"encounter": str(encounter.pk), "addendum_to": note["id"], "plan": "RDT positive"},
        format="json",
    )
    assert addendum.status_code == 201
    assert addendum.json()["addendum_to"] == note["id"]


def test_empty_note_cannot_be_closed(doctor, encounter):
    empty = doctor.post(NOTES, {"encounter": str(encounter.pk)}, format="json").json()
    assert doctor.post(f"{NOTES}{empty['id']}/close/").status_code == 400


def test_note_entered_in_error_is_hidden_but_kept(doctor, note, patient):
    doctor.post(
        f"{NOTES}{note['id']}/entered-in-error/", {"reason": "Wrong patient"}, format="json"
    )
    assert doctor.get(NOTES, {"patient": str(patient.pk)}).json()["results"] == []
    history = doctor.get(NOTES, {"patient": str(patient.pk), "history": "true"}).json()["results"]
    assert [n["id"] for n in history] == [note["id"]]


# -- encounters ----------------------------------------------------------------------


def test_encounter_defaults_the_practitioner_to_the_caller(doctor, doctor_user, patient, org):
    response = doctor.post(
        ENCOUNTERS,
        {
            "patient": str(patient.pk),
            "encounter_class": "outpatient",
            "facility": str(org["facility"].pk),
            "department": str(org["medicine"].pk),
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    assert response.json()["practitioner"] == str(doctor_user.pk)
    assert response.json()["status"] == "in_progress"


def test_no_encounter_for_a_deceased_patient(doctor, patient, org, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        Patient.objects.filter(pk=patient.pk).update(
            status="deceased", deceased_at=date(2026, 1, 1)
        )
    response = doctor.post(
        ENCOUNTERS,
        {
            "patient": str(patient.pk),
            "encounter_class": "outpatient",
            "facility": str(org["facility"].pk),
            "department": str(org["medicine"].pk),
        },
        format="json",
    )
    assert response.status_code == 400
    assert "patient" in response.json()["error"]["details"]


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        (["finished"], True),
        (["cancelled"], True),
        (["finished", "in_progress"], False),
        (["cancelled", "finished"], False),
        (["planned"], False),
    ],
)
def test_encounter_status_transitions(doctor, encounter, path, allowed):
    responses = [
        doctor.post(f"{ENCOUNTERS}{encounter.pk}/status/", {"status": s}, format="json")
        for s in path
    ]
    assert all(r.status_code == 200 for r in responses[:-1])
    assert (responses[-1].status_code == 200) is allowed


# -- access scopes (SEC-02) ----------------------------------------------------------


def test_sec_02_doctors_see_only_their_departments_encounters_and_vitals(
    doctor, make_encounter, encounter
):
    surgical = make_encounter(department="surgery")
    listed = [e["id"] for e in doctor.get(ENCOUNTERS).json()["results"]]
    assert listed == [str(encounter.pk)]
    assert doctor.get(f"{ENCOUNTERS}{surgical.pk}/").status_code == 403
    response = doctor.post(
        "/api/clinical/vitals/",
        {"encounter": str(surgical.pk), "readings": [{"code": "8867-4", "value": 70}]},
        format="json",
    )
    assert response.status_code == 403


def test_sec_02_break_glass_opens_an_out_of_department_encounter(doctor, make_encounter):
    surgical = make_encounter(department="surgery")
    response = doctor.post(
        "/api/accounts/break-glass/",
        {
            "resource": "clinical.encounter",
            "object_id": str(surgical.pk),
            "reason": "Covering the surgical ward overnight emergency",
        },
        format="json",
    )
    assert response.status_code == 201
    assert doctor.get(f"{ENCOUNTERS}{surgical.pk}/").status_code == 200


def test_sec_02_pharmacist_reads_vitals_and_diagnoses_but_writes_nothing(
    make_user, tenant_a, signed_in, doctor, encounter
):
    doctor.post(
        "/api/clinical/vitals/",
        {"encounter": str(encounter.pk), "readings": [{"code": "29463-7", "value": 70}]},
        format="json",
    )
    pharmacist = signed_in(make_user("pharm", tenant_a, [Role.PHARMACIST]))
    assert len(pharmacist.get("/api/clinical/vitals/").json()["results"]) == 1
    assert pharmacist.get("/api/clinical/diagnoses/").status_code == 200
    assert pharmacist.get(NOTES).status_code == 403
    response = pharmacist.post(
        "/api/clinical/diagnoses/",
        {"encounter": str(encounter.pk), "code_system": "icd10", "code": "I10"},
        format="json",
    )
    assert response.status_code == 403


@pytest.mark.parametrize("role", [Role.FRONT_DESK, Role.BILLING_OFFICER, Role.TENANT_ADMIN])
def test_sec_02_non_clinical_roles_see_no_clinical_data(
    role, make_user, tenant_a, signed_in, encounter
):
    client = signed_in(make_user("someone", tenant_a, [role]))
    for url in (ENCOUNTERS, "/api/clinical/vitals/", "/api/clinical/diagnoses/", NOTES):
        assert client.get(url).status_code == 403, url


def test_sec_07_another_tenants_encounter_is_invisible(doctor, tenant_b, as_tenant, make_user):
    from apps.clinical.models import Encounter
    from apps.tenants.models import Facility

    other_doctor = make_user("other", tenant_b, [Role.DOCTOR])
    with as_tenant(tenant_b, other_doctor):
        facility = Facility.objects.create(name="B main", code="b")
        foreign_patient = Patient.objects.create(
            first_name="Tunde", last_name="Bello", date_of_birth=date(1970, 1, 1)
        )
        foreign = Encounter.objects.create(
            patient=foreign_patient,
            encounter_class="outpatient",
            facility=facility,
            practitioner=other_doctor,
        )
    assert doctor.get(f"{ENCOUNTERS}{foreign.pk}/").status_code == 404


# -- reference codes -----------------------------------------------------------------


def test_reference_codes_are_seeded_and_searchable(doctor, api_client):
    loinc = doctor.get("/api/clinical/codes/loinc/").json()
    assert {"code": "39156-5", "unit": "kg/m2"}.items() <= next(
        c for c in loinc if c["code"] == "39156-5"
    ).items()
    malaria = doctor.get("/api/clinical/codes/icd10/", {"q": "malaria"}).json()["results"]
    assert {c["code"] for c in malaria} == {"B50.9", "B54"}
    assert api_client.get("/api/clinical/codes/icd10/").status_code == 401
