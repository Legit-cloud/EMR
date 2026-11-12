"""Patient registration: validation, MRN generation, search and tenant isolation."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.exceptions import ValidationError
from django.db import connection

from apps.core.tenancy import tenant_context
from apps.patients.models import Patient
from apps.patients.normalize import name_key, normalize_phone, validate_person_name

from .conftest import ADA

pytestmark = pytest.mark.django_db

NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"]

PATIENTS = "/api/patients/patients/"


# -- names and phones --------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "José",
        "O'Brien",
        "D’Angelo",
        "Anne-Marie",
        "Mary Ann",
        "Zoë",
        "Ọlábísí",
        "Ngozi",
        "Nwachukwu",
    ],
)
def test_names_accept_letters_spaces_hyphens_apostrophes_and_accents(name):
    validate_person_name(name)


@pytest.mark.parametrize(
    "name", ["", "   ", "John3", "Robert;DROP", "_Ann", "-Ann", "Ann--Marie", "Ann  -Marie", "#1"]
)
def test_names_reject_digits_symbols_and_stray_separators(name):
    with pytest.raises(ValidationError):
        validate_person_name(name)


def test_decomposed_accents_are_normalised_before_checking():
    validate_person_name("José")  # e + combining acute accent
    assert name_key("José") == name_key("JOSE") == "jose"


@pytest.mark.parametrize(
    ("raw", "e164"),
    [
        ("0803 123 4567", "+2348031234567"),
        ("+234 803-123-4567", "+2348031234567"),
        ("00447911123456", "+447911123456"),
        ("(0)803 123 4567", "+2348031234567"),
    ],
)
def test_phone_numbers_are_stored_in_e164(raw, e164):
    assert normalize_phone(raw) == e164


def test_invalid_phone_is_rejected(clerk):
    response = clerk.post(PATIENTS, {**ADA, "phone": "12"}, format="json")
    assert response.status_code == 400
    assert "phone" in response.json()["error"]["details"]


# -- registration ------------------------------------------------------------------


def test_registration_creates_patient_with_generated_mrn(clerk, tenant_a):
    response = clerk.post(PATIENTS, {**ADA, "national_id": "nin-123 456"}, format="json")
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["mrn"].startswith(f"{datetime.now(ZoneInfo('Africa/Lagos')).year}-")
    assert body["phone"] == "+2348031234567"
    assert body["national_id"] == "NIN123456"
    assert body["status"] == "active"


def test_registration_rejects_invalid_names_and_future_birth_dates(clerk):
    response = clerk.post(
        PATIENTS, {**ADA, "first_name": "Ad4eze", "date_of_birth": "2999-01-01"}, format="json"
    )
    assert response.status_code == 400
    assert set(response.json()["error"]["details"]) == {"first_name", "date_of_birth"}


def test_mrn_and_status_cannot_be_set_or_changed_through_the_api(clerk):
    created = clerk.post(PATIENTS, {**ADA, "mrn": "HACK-1", "status": "deceased"}, format="json")
    body = created.json()
    assert body["mrn"] != "HACK-1" and body["status"] == "active"
    response = clerk.patch(f"{PATIENTS}{body['id']}/", {"mrn": "HACK-2"}, format="json")
    assert response.status_code == 200
    assert response.json()["mrn"] == body["mrn"]


def test_mrn_can_never_change_in_code(make_patient, tenant_a, as_tenant):
    patient = make_patient()
    with as_tenant(tenant_a):
        patient = Patient.objects.get(pk=patient.pk)
        patient.mrn = "2026-999999"
        with pytest.raises(ValidationError):
            patient.save()


def test_mrn_sequences_are_per_tenant(make_patient, tenant_a, tenant_b):
    a1 = make_patient(first_name="Chidi")
    a2 = make_patient(first_name="Emeka", date_of_birth=date(1980, 1, 1))
    b1 = make_patient(tenant=tenant_b, first_name="Chidi")
    assert a1.mrn.endswith("-000001") and a2.mrn.endswith("-000002")
    assert b1.mrn.endswith("-000001")


def test_mrn_year_follows_lagos_time_at_new_year(make_patient):
    # 23:30 UTC on 31 December is already 00:30 on 1 January in Lagos.
    instant = datetime(2026, 12, 31, 23, 30, tzinfo=ZoneInfo("UTC"))
    with mock.patch("apps.patients.mrn.timezone.now", return_value=instant):
        patient = make_patient()
    assert patient.mrn == "2027-000001"


@pytest.mark.django_db(transaction=True)
def test_concurrent_registrations_never_share_an_mrn(make_tenant):
    tenant = make_tenant("busy-clinic")
    workers = 8
    barrier = threading.Barrier(workers)

    def register(i):
        try:
            with tenant_context(tenant.id):
                barrier.wait()
                # Straight to the model: the MRN generator must be safe on its own, not
                # only behind the registration lock.
                patient = Patient.objects.create(
                    first_name="Patient",
                    last_name=NATO[i],
                    date_of_birth=date(1950 + i * 7, 1 + i, 1 + i),
                )
                return patient.mrn
        finally:
            connection.close()

    with ThreadPoolExecutor(workers) as pool:
        mrns = list(pool.map(register, range(workers)))
    assert len(set(mrns)) == workers
    assert sorted(int(m.split("-")[1]) for m in mrns) == list(range(1, workers + 1))


# -- search and isolation ----------------------------------------------------------


def test_search_by_name_mrn_or_phone(doctor, make_patient):
    ada = make_patient(phone="+2348031234567")
    make_patient(first_name="Bayo", last_name="Adeyemi", date_of_birth=date(1975, 2, 2))
    for query in ("okonkwo", "ADAEZE", ada.mrn, "+2348031234567"):
        results = doctor.get(PATIENTS, {"q": query}).json()["results"]
        assert [r["id"] for r in results] == [str(ada.pk)], query


def test_sec_07_other_tenants_patients_are_invisible(doctor, make_patient, tenant_b):
    foreign = make_patient(tenant=tenant_b)
    assert doctor.get(PATIENTS).json()["results"] == []
    assert doctor.get(f"{PATIENTS}{foreign.pk}/").status_code == 404


def test_sec_02_billing_can_view_but_not_register(make_user, tenant_a, signed_in, make_patient):
    from apps.core.roles import Role

    make_patient()
    billing = signed_in(make_user("billing", tenant_a, [Role.BILLING_OFFICER]))
    assert billing.get(PATIENTS).status_code == 200
    assert billing.post(PATIENTS, ADA, format="json").status_code == 403


def test_sec_03_reading_a_patient_is_audited(doctor, doctor_user, make_patient):
    from apps.audit.models import AuditEntry

    patient = make_patient()
    doctor.get(f"{PATIENTS}{patient.pk}/")
    entry = AuditEntry.objects.get(action="read", resource="patients.patient")
    assert (entry.actor_id, entry.object_id) == (doctor_user.pk, str(patient.pk))
