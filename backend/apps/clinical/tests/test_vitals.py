"""Vital signs: LOINC codes, UCUM units, automatic BMI, recorder, timestamp, encounter link."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.clinical import selectors
from apps.clinical.models import compute_bmi

pytestmark = pytest.mark.django_db

VITALS = "/api/clinical/vitals/"


def record(client, encounter, readings, **extra):
    return client.post(
        VITALS,
        {
            "encounter": str(encounter.pk),
            "readings": [{"code": c, "value": v} for c, v in readings.items()],
            **extra,
        },
        format="json",
    )


def by_code(body):
    return {o["code"]: o for o in body["observations"]}


def test_vitals_are_coded_with_loinc_and_ucum(doctor, doctor_user, encounter, patient):
    response = record(
        doctor, encounter, {"8480-6": 128, "8462-4": 84, "8867-4": 72, "8310-5": 36.8}
    )
    assert response.status_code == 201, response.json()
    body = response.json()
    readings = by_code(body)
    assert readings["8480-6"]["unit"] == "mm[Hg]"
    assert readings["8867-4"]["unit"] == "/min"
    assert readings["8310-5"] == {
        "code": "8310-5",
        "display": "Body temperature",
        "value": "36.80",
        "unit": "Cel",
    }
    assert body["recorded_by"] == str(doctor_user.pk)
    assert body["patient"] == str(patient.pk)
    assert body["encounter"] == str(encounter.pk)
    assert body["recorded_at"]


def test_bmi_is_computed_from_height_and_weight(doctor, encounter):
    body = record(doctor, encounter, {"29463-7": 70, "8302-2": 175}).json()
    bmi = by_code(body)["39156-5"]
    assert (bmi["value"], bmi["unit"]) == ("22.90", "kg/m2")


def test_bmi_uses_the_latest_height_from_the_past_year(doctor, encounter):
    record(
        doctor,
        encounter,
        {"8302-2": 160},
        recorded_at=(timezone.now() - timedelta(days=30)).isoformat(),
    )
    body = record(doctor, encounter, {"29463-7": 64}).json()
    assert by_code(body)["39156-5"]["value"] == "25.00"


def test_no_bmi_without_a_recent_height(doctor, encounter):
    old = (timezone.now() - timedelta(days=400)).isoformat()
    record(doctor, encounter, {"8302-2": 160}, recorded_at=old)
    body = record(doctor, encounter, {"29463-7": 64}).json()
    assert "39156-5" not in by_code(body)


def test_bmi_cannot_be_entered(doctor, encounter):
    response = record(doctor, encounter, {"39156-5": 30})
    assert response.status_code == 400
    assert "calculated" in response.json()["error"]["details"]["readings"][0]


@pytest.mark.parametrize(
    ("readings", "message"),
    [
        ({"1234-5": 1}, "unknown LOINC"),
        ({"8480-6": 400}, "outside"),
        ({"59408-5": 101}, "outside"),
        ({"8310-5": 25}, "outside"),
    ],
)
def test_implausible_or_unknown_readings_are_rejected(doctor, encounter, readings, message):
    response = record(doctor, encounter, readings)
    assert response.status_code == 400
    assert message in response.json()["error"]["details"]["readings"][0]


def test_unit_must_be_the_ucum_unit_of_the_code(doctor, encounter):
    response = doctor.post(
        VITALS,
        {
            "encounter": str(encounter.pk),
            "readings": [{"code": "8310-5", "value": 98.6, "unit": "[degF]"}],
        },
        format="json",
    )
    assert response.status_code == 400
    assert "Cel" in response.json()["error"]["details"]["readings"][0]


def test_empty_and_future_sets_are_rejected(doctor, encounter):
    assert record(doctor, encounter, {}).status_code == 400
    future = (timezone.now() + timedelta(hours=2)).isoformat()
    response = record(doctor, encounter, {"8867-4": 70}, recorded_at=future)
    assert "recorded_at" in response.json()["error"]["details"]


def test_cancelled_encounter_takes_no_new_vitals(doctor, make_encounter):
    cancelled = make_encounter(status="cancelled")
    response = record(doctor, cancelled, {"8867-4": 70})
    assert response.status_code == 400
    assert "encounter" in response.json()["error"]["details"]


def test_entered_in_error_vitals_leave_the_chart_but_stay_in_history(
    doctor, encounter, patient, tenant_a, as_tenant
):
    good = record(doctor, encounter, {"29463-7": 70}).json()
    wrong = record(doctor, encounter, {"29463-7": 95}).json()
    response = doctor.post(
        f"{VITALS}{wrong['id']}/entered-in-error/", {"reason": "Wrong scale"}, format="json"
    )
    assert response.json()["record_state"] == "entered_in_error"

    chart = doctor.get(VITALS, {"patient": str(patient.pk)}).json()["results"]
    history = doctor.get(VITALS, {"patient": str(patient.pk), "history": "true"}).json()["results"]
    assert [v["id"] for v in chart] == [good["id"]]
    assert {v["id"] for v in history} == {good["id"], wrong["id"]}
    with as_tenant(tenant_a):
        assert selectors.latest_observation(patient.pk, "29463-7")["value"] == Decimal("70.00")
    assert doctor.delete(f"{VITALS}{wrong['id']}/").status_code == 405


def test_compute_bmi_rounds_to_one_decimal():
    assert compute_bmi(Decimal("81.5"), Decimal("180")) == Decimal("25.2")
