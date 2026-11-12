"""Portal: a patient sees a lab or imaging result only after a clinician has reviewed it.
Requirement IDs: SEC-02, SEC-03, SEC-07, DG-03."""

import pytest

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.diagnostics.models import Investigation

pytestmark = pytest.mark.django_db

PORTAL = "/api/portal/"
ORDERS = "/api/diagnostics/orders/"
RESULTS = "/api/diagnostics/results/"


@pytest.fixture
def doctor(make_user, signed_in, tenant_a):
    return signed_in(
        make_user("doc-res", tenant_a, [Role.DOCTOR], first_name="Chidi", last_name="Eze")
    )


@pytest.fixture
def tech(make_user, signed_in, tenant_a):
    return signed_in(make_user("tech-res", tenant_a, [Role.LAB_TECHNICIAN]))


@pytest.fixture
def released(doctor, tech, ada, tenant_a):
    """A reviewed laboratory result for Ada."""
    with tenant_context(tenant_a.id):
        test = Investigation.objects.create(
            kind="lab", name="Fasting glucose", unit="mmol/L", reference_range="3.9 - 5.5"
        )
    order = doctor.post(
        ORDERS,
        {"patient": str(ada.pk), "investigation": str(test.pk), "reason": "Check-up"},
        format="json",
    ).json()
    result = tech.post(
        RESULTS, {"order": order["id"], "value": "7.2", "flag": "abnormal"}, format="json"
    ).json()
    return result["id"]


def review(doctor, result_id):
    assert doctor.post(f"{RESULTS}{result_id}/review/").status_code == 200


def test_an_unreviewed_result_is_hidden_from_the_patient(as_patient, ada, released):
    client, _ = as_patient(ada)
    assert client.get(f"{PORTAL}results/").json() == []
    assert client.get(f"{PORTAL}home/").json()["new_results"] == 0
    assert client.post(f"{PORTAL}results/{released}/seen/").status_code == 404


def test_a_reviewed_result_appears_and_can_be_marked_seen(as_patient, doctor, ada, released):
    review(doctor, released)
    client, _ = as_patient(ada)
    (row,) = client.get(f"{PORTAL}results/").json()
    assert (row["name"], row["value"], row["unit"], row["flag"]) == (
        "Fasting glucose",
        "7.2",
        "mmol/L",
        "abnormal",
    )
    assert row["ordered_by"] == "Chidi Eze" and row["seen"] is False
    assert client.get(f"{PORTAL}home/").json()["new_results"] == 1
    assert client.post(f"{PORTAL}results/{released}/seen/").json()["seen"] is True
    assert client.get(f"{PORTAL}home/").json()["new_results"] == 0


def test_a_corrected_result_is_hidden_until_reviewed_again(as_patient, doctor, tech, ada, released):
    review(doctor, released)
    tech.post(
        f"{RESULTS}{released}/correct/",
        {"reason": "Wrong sample", "value": "5.0", "flag": "normal"},
        format="json",
    )
    client, _ = as_patient(ada)
    assert client.get(f"{PORTAL}results/").json() == []


def test_sec_07_a_patient_cannot_open_another_patients_result(as_patient, doctor, bola, released):
    review(doctor, released)
    client, _ = as_patient(bola)
    assert client.get(f"{PORTAL}results/").json() == []
    assert client.post(f"{PORTAL}results/{released}/seen/").status_code == 404


def test_sec_03_reading_and_opening_results_is_audited(as_patient, doctor, ada, released):
    review(doctor, released)
    client, _ = as_patient(ada)
    client.get(f"{PORTAL}results/")
    client.post(f"{PORTAL}results/{released}/seen/")
    entries = AuditEntry.objects.filter(resource="portal.result")
    assert {e.action for e in entries} >= {"read", "update"}
