"""Diagnoses: coding, the five clinical and four verification statuses, abatement, ranking."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.clinical import selectors

pytestmark = pytest.mark.django_db

DIAGNOSES = "/api/clinical/diagnoses/"


@pytest.fixture
def add(doctor, encounter):
    def add(code="B54", **extra):
        payload = {"encounter": str(encounter.pk), "code_system": "icd10", "code": code, **extra}
        return doctor.post(DIAGNOSES, payload, format="json")

    return add


def patch(doctor, diagnosis, **changes):
    return doctor.patch(f"{DIAGNOSES}{diagnosis['id']}/", changes, format="json")


# -- coding --------------------------------------------------------------------------


def test_icd10_code_is_validated_and_display_filled_in(add):
    response = add(code="b50.9", display="anything")
    assert response.status_code == 201, response.json()
    body = response.json()
    assert (body["code"], body["display"]) == (
        "B50.9",
        "Plasmodium falciparum malaria, unspecified",
    )
    assert (body["clinical_status"], body["verification_status"]) == ("active", "unconfirmed")
    assert add(code="X99.9").status_code == 400


def test_snomed_code_needs_a_concept_id_and_display(add):
    assert (
        add(code_system="snomed", code="38341003", display="Hypertensive disorder").status_code
        == 201
    )
    assert add(code_system="snomed", code="hypertension", display="x").status_code == 400
    assert add(code_system="snomed", code="38341003").status_code == 400


def test_a_diagnosis_cannot_be_recoded(add, doctor):
    diagnosis = add().json()
    assert patch(doctor, diagnosis, code="I10").status_code == 400


# -- ranking -------------------------------------------------------------------------


def test_ranks_are_assigned_in_order_and_unique_per_encounter(add):
    assert add(code="B54").json()["rank"] == 1
    assert add(code="I10").json()["rank"] == 2
    response = add(code="E11.9", rank=1)
    assert response.status_code == 400


def test_rank_diagnoses_reorders_the_encounter(add, doctor, encounter):
    first, second, third = (add(code=c).json() for c in ("B54", "I10", "E11.9"))
    response = doctor.post(
        f"/api/clinical/encounters/{encounter.pk}/rank-diagnoses/",
        {"diagnosis_ids": [third["id"], first["id"], second["id"]]},
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert [(d["code"], d["rank"]) for d in response.json()] == [
        ("E11.9", 1),
        ("B54", 2),
        ("I10", 3),
    ]
    incomplete = doctor.post(
        f"/api/clinical/encounters/{encounter.pk}/rank-diagnoses/",
        {"diagnosis_ids": [first["id"]]},
        format="json",
    )
    assert incomplete.status_code == 400


def test_entered_in_error_frees_its_rank(add, doctor):
    wrong = add(code="I10").json()
    doctor.post(
        f"{DIAGNOSES}{wrong['id']}/entered-in-error/", {"reason": "Wrong patient"}, format="json"
    )
    assert add(code="B54", rank=1).status_code == 201


# -- abatement -----------------------------------------------------------------------


def test_resolved_needs_an_abatement_date(add, doctor):
    assert add(clinical_status="resolved").status_code == 400
    diagnosis = add().json()
    response = patch(doctor, diagnosis, clinical_status="resolved")
    assert response.status_code == 400
    assert "abatement_date" in response.json()["error"]["details"]
    today = timezone.localdate().isoformat()
    response = patch(doctor, diagnosis, clinical_status="resolved", abatement_date=today)
    assert response.status_code == 200


def test_abatement_date_rules(add):
    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    assert add(clinical_status="resolved", abatement_date=tomorrow).status_code == 400
    assert add(clinical_status="active", abatement_date="2026-01-01").status_code == 400
    response = add(clinical_status="resolved", onset_date="2026-02-01", abatement_date="2026-01-01")
    assert response.status_code == 400


# -- status transitions --------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        (["remission", "recurrence", "resolved"], True),
        (["inactive", "recurrence", "remission"], True),
        (["resolved", "recurrence"], True),
        (["resolved", "active"], False),
        (["resolved", "remission"], False),
        (["remission", "active"], False),
        (["inactive", "active"], False),
    ],
)
def test_clinical_status_transitions(add, doctor, path, allowed):
    diagnosis = add().json()
    today = timezone.localdate().isoformat()
    responses = []
    for status in path:
        abated = status in ("resolved", "remission", "inactive")
        responses.append(
            patch(
                doctor, diagnosis, clinical_status=status, abatement_date=today if abated else None
            )
        )
    final = responses[-1]
    assert all(r.status_code == 200 for r in responses[:-1]), [r.json() for r in responses]
    assert (final.status_code == 200) is allowed, final.json()
    if not allowed:
        assert "clinical_status" in final.json()["error"]["details"]


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        (["confirmed"], True),
        (["refuted"], True),
        (["confirmed", "refuted"], True),
        (["confirmed", "unconfirmed"], False),
        (["refuted", "confirmed"], False),
        (["entered_in_error"], False),
    ],
)
def test_verification_status_transitions(add, doctor, path, allowed):
    diagnosis = add().json()
    responses = [patch(doctor, diagnosis, verification_status=status) for status in path]
    assert all(r.status_code == 200 for r in responses[:-1])
    assert (responses[-1].status_code == 200) is allowed, responses[-1].json()


def test_cannot_be_created_as_entered_in_error(add):
    assert add(verification_status="entered_in_error").status_code == 400


# -- the active chart ----------------------------------------------------------------


def test_entered_in_error_hides_from_the_problem_list_but_stays_in_history(
    add, doctor, patient, tenant_a, as_tenant
):
    current = add(code="I10", verification_status="confirmed").json()
    refuted = add(code="B54").json()
    patch(doctor, refuted, verification_status="refuted")
    wrong = add(code="E11.9").json()
    response = doctor.post(
        f"{DIAGNOSES}{wrong['id']}/entered-in-error/", {"reason": "Wrong patient"}, format="json"
    )
    assert response.json()["verification_status"] == "entered_in_error"
    assert response.json()["record_state"] == "entered_in_error"

    with as_tenant(tenant_a):
        problems = selectors.active_problem_list(patient.pk)
    assert [p["code"] for p in problems] == ["I10"]

    listed = doctor.get(DIAGNOSES, {"patient": str(patient.pk)}).json()["results"]
    assert {d["id"] for d in listed} == {current["id"], refuted["id"]}
    current_only = doctor.get(DIAGNOSES, {"patient": str(patient.pk), "current": "true"}).json()
    assert [d["id"] for d in current_only["results"]] == [current["id"]]
    history = doctor.get(DIAGNOSES, {"patient": str(patient.pk), "history": "true"}).json()
    assert wrong["id"] in {d["id"] for d in history["results"]}
    # Hidden rows cannot be edited back into the chart.
    assert patch(doctor, wrong, verification_status="confirmed").status_code == 400
