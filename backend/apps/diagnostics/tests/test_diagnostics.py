"""Diagnostics: laboratory and imaging orders, results, billing and release to the patient.
Requirement IDs: SEC-02, SEC-03, SEC-07, FR-5 (results saved to the chart and appended to the
invoice), AC (results reviewed before the patient sees them)."""

from datetime import date

import pytest
from django.core import mail

from apps.audit.models import AuditEntry
from apps.billing.models import Invoice, InvoiceLine
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.diagnostics import selectors
from apps.diagnostics.models import DiagnosticOrder, DiagnosticResult, Investigation
from apps.patients.models import Patient, PatientStatus

pytestmark = pytest.mark.django_db

CATALOGUE = "/api/diagnostics/investigations/"
ORDERS = "/api/diagnostics/orders/"
RESULTS = "/api/diagnostics/results/"


@pytest.fixture
def patient(tenant_a):
    with tenant_context(tenant_a.id):
        return Patient.objects.create(
            first_name="Ife", last_name="Bello", date_of_birth=date(1990, 3, 3)
        )


@pytest.fixture
def full_blood_count(tenant_a):
    with tenant_context(tenant_a.id):
        return Investigation.objects.create(
            kind="lab",
            name="Full blood count",
            code="58410-2",
            unit="g/dL",
            reference_range="12 - 16",
            price_minor=450_000,
        )


@pytest.fixture
def chest_xray(tenant_a):
    with tenant_context(tenant_a.id):
        return Investigation.objects.create(kind="imaging", name="Chest X-ray", price_minor=900_000)


@pytest.fixture
def doctor(make_user, signed_in, tenant_a):
    user = make_user("doctor-dx", tenant_a, [Role.DOCTOR], email="doc@example.test")
    return signed_in(user)


@pytest.fixture
def tech(make_user, signed_in, tenant_a):
    return signed_in(make_user("tech-dx", tenant_a, [Role.LAB_TECHNICIAN]))


@pytest.fixture
def nurse(make_user, signed_in, tenant_a):
    return signed_in(make_user("nurse-dx", tenant_a, [Role.NURSE]))


@pytest.fixture
def admin(make_user, signed_in, tenant_a):
    return signed_in(make_user("admin-dx", tenant_a, [Role.TENANT_ADMIN]))


def order(client, patient, test, reason="Fever for three days", **extra):
    return client.post(
        ORDERS,
        {"patient": str(patient.pk), "investigation": str(test.pk), "reason": reason, **extra},
        format="json",
    )


def record(client, order_id, **body):
    return client.post(RESULTS, {"order": order_id, **body}, format="json")


@pytest.fixture
def placed(doctor, patient, full_blood_count, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = order(doctor, patient, full_blood_count)
    assert response.status_code == 201
    return response.json()["id"]


# -- ordering and the bill -----------------------------------------------------------------


def test_ordering_puts_a_pending_line_on_the_bill_at_the_price_when_ordered(
    doctor, patient, full_blood_count, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        body = order(doctor, patient, full_blood_count).json()
    assert body["status"] == "ordered"
    assert body["patient_name"] == "Ife Bello"
    assert body["unit_price_minor"] == 450_000
    with tenant_context(tenant_a.id):
        line = InvoiceLine.objects.get()
        assert (line.status, line.revenue_category, line.amount_minor) == (
            "pending",
            "laboratory",
            450_000,
        )
        assert line.description == "Full blood count"
        # A later price change does not alter the order.
        Investigation.objects.filter(pk=full_blood_count.pk).update(price_minor=999)
        assert DiagnosticOrder.objects.get().unit_price_minor == 450_000


def test_imaging_is_billed_as_imaging(
    doctor, patient, chest_xray, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        assert order(doctor, patient, chest_xray).status_code == 201
    with tenant_context(tenant_a.id):
        assert InvoiceLine.objects.get().revenue_category == "imaging"


def test_a_replayed_ordered_event_does_not_bill_twice(placed, tenant_a):
    from apps.diagnostics import tasks

    envelope = {"tenant_id": str(tenant_a.id), "actor_id": None, "payload": {"order_id": placed}}
    tasks.request_invoice_line(envelope)
    tasks.request_invoice_line(envelope)
    with tenant_context(tenant_a.id):
        assert InvoiceLine.objects.count() == 1


def test_the_reason_is_required(doctor, patient, full_blood_count):
    response = order(doctor, patient, full_blood_count, reason=" ")
    assert response.status_code == 400


def test_cannot_order_for_a_deceased_patient(doctor, patient, full_blood_count, tenant_a):
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=patient.pk).update(
            status=PatientStatus.DECEASED, deceased_at=date(2026, 1, 1)
        )
    response = order(doctor, patient, full_blood_count)
    assert response.status_code == 409
    assert "deceased" in response.json()["error"]["message"]


def test_cannot_order_a_test_that_is_not_offered(doctor, patient, full_blood_count, tenant_a):
    with tenant_context(tenant_a.id):
        Investigation.objects.filter(pk=full_blood_count.pk).update(active=False)
    assert order(doctor, patient, full_blood_count).status_code == 409


# -- results -------------------------------------------------------------------------------


def test_a_lab_result_needs_a_value_and_an_imaging_result_needs_a_report(
    tech, doctor, patient, full_blood_count, chest_xray
):
    lab_id = order(doctor, patient, full_blood_count).json()["id"]
    assert record(tech, lab_id, flag="normal").status_code == 409
    scan_id = order(doctor, patient, chest_xray).json()["id"]
    assert record(tech, scan_id, report="ok").status_code == 409
    assert record(tech, scan_id, report="Clear lung fields. No effusion.").status_code == 201


def test_recording_a_result_finalises_the_charge_and_takes_the_units_from_the_catalogue(
    tech, placed, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = record(tech, placed, value="10.2", flag="abnormal")
    assert response.status_code == 201
    body = response.json()
    assert (body["unit"], body["reference_range"], body["version"]) == ("g/dL", "12 - 16", 1)
    with tenant_context(tenant_a.id):
        assert DiagnosticOrder.objects.get().status == "resulted"
        assert InvoiceLine.objects.get().status == "final"
        assert Invoice.objects.get().total_minor == 450_000


def test_a_second_result_is_refused_use_a_correction(tech, placed):
    assert record(tech, placed, value="10.2").status_code == 201
    assert record(tech, placed, value="11.0").status_code == 409


def test_a_correction_keeps_the_old_version_and_asks_for_review_again(
    tech, doctor, placed, tenant_a, django_capture_on_commit_callbacks
):
    first = record(tech, placed, value="10.2").json()
    assert doctor.post(f"{RESULTS}{first['id']}/review/").status_code == 200
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = tech.post(
            f"{RESULTS}{first['id']}/correct/",
            {"reason": "Sample was mislabelled", "value": "13.1", "flag": "normal"},
            format="json",
        )
    assert response.status_code == 201
    assert (response.json()["version"], response.json()["is_reviewed"]) == (2, False)
    with tenant_context(tenant_a.id):
        old, new = DiagnosticResult.objects.order_by("version")
        assert (old.value, old.superseded) == ("10.2", True)
        assert (new.value, new.superseded) == ("13.1", False)
    assert any("corrected" in m.subject for m in mail.outbox)


def test_a_correction_needs_a_reason(tech, placed):
    first = record(tech, placed, value="10.2").json()
    response = tech.post(
        f"{RESULTS}{first['id']}/correct/",
        {"reason": "", "value": "13.1", "flag": "normal"},
        format="json",
    )
    assert response.status_code == 400


def test_a_critical_result_emails_the_orderer_without_the_value(
    tech, placed, django_capture_on_commit_callbacks
):
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        record(tech, placed, value="4.1", flag="critical")
    alerts = [m for m in mail.outbox if "critical" in m.subject.lower()]
    assert len(alerts) == 1 and alerts[0].to == ["doc@example.test"]
    assert "4.1" not in alerts[0].body


def test_a_normal_result_sends_no_alert(tech, placed, django_capture_on_commit_callbacks):
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        record(tech, placed, value="13.0", flag="normal")
    assert not [m for m in mail.outbox if "critical" in m.subject.lower()]


# -- cancelling ---------------------------------------------------------------------------


def test_cancelling_before_a_result_voids_the_charge(
    doctor, placed, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = doctor.post(
            f"{ORDERS}{placed}/cancel/", {"reason": "Ordered in error"}, format="json"
        )
    assert response.status_code == 200 and response.json()["status"] == "cancelled"
    with tenant_context(tenant_a.id):
        assert InvoiceLine.objects.get().status == "void"
        assert Invoice.objects.get().total_minor == 0


def test_cannot_cancel_after_a_result_or_record_a_result_after_cancelling(
    doctor, tech, placed, patient, full_blood_count
):
    assert record(tech, placed, value="12.5").status_code == 201
    no = doctor.post(f"{ORDERS}{placed}/cancel/", {"reason": "oops"}, format="json")
    assert no.status_code == 409
    other = order(doctor, patient, full_blood_count).json()["id"]
    yes = doctor.post(f"{ORDERS}{other}/cancel/", {"reason": "oops"}, format="json")
    assert yes.status_code == 200
    assert record(tech, other, value="1").status_code == 409


def test_the_sample_can_be_marked_taken_once(tech, placed):
    assert tech.post(f"{ORDERS}{placed}/collect/").json()["status"] == "collected"
    assert tech.post(f"{ORDERS}{placed}/collect/").status_code == 409
    assert record(tech, placed, value="12.5").status_code == 201


# -- release to the patient ---------------------------------------------------------------


def test_results_reach_the_patient_only_after_a_clinician_reviews_them(
    tech, doctor, placed, patient, tenant_a
):
    result = record(tech, placed, value="12.5").json()
    with tenant_context(tenant_a.id):
        assert selectors.released_results(patient.pk) == []
        assert selectors.unreviewed_result_count() == 1
    assert doctor.post(f"{RESULTS}{result['id']}/review/").status_code == 200
    with tenant_context(tenant_a.id):
        released = selectors.released_results(patient.pk)
        assert [r["name"] for r in released] == ["Full blood count"]
        assert selectors.unreviewed_result_count() == 0


def test_the_technician_cannot_review_their_own_result(tech, placed):
    result = record(tech, placed, value="12.5").json()
    assert tech.post(f"{RESULTS}{result['id']}/review/").status_code == 403


# -- who may do what ----------------------------------------------------------------------


def test_sec_02_only_a_doctor_orders_only_a_technician_records(
    nurse, tech, doctor, admin, patient, full_blood_count, placed
):
    assert order(nurse, patient, full_blood_count).status_code == 403
    assert order(tech, patient, full_blood_count).status_code == 403
    assert order(admin, patient, full_blood_count).status_code == 403
    assert record(doctor, placed, value="12.5").status_code == 403
    assert record(nurse, placed, value="12.5").status_code == 403
    assert record(admin, placed, value="12.5").status_code == 403


def test_sec_02_the_admin_sets_up_the_catalogue_and_others_cannot(admin, doctor, tech):
    body = {"kind": "lab", "name": "Malaria test", "price_minor": 150_000}
    assert doctor.post(CATALOGUE, body, format="json").status_code == 403
    assert tech.post(CATALOGUE, body, format="json").status_code == 403
    assert admin.post(CATALOGUE, body, format="json").status_code == 201
    assert doctor.get(CATALOGUE).status_code == 200


def test_sec_02_the_admin_can_see_orders_and_results_but_not_change_them(admin, tech, placed):
    result = record(tech, placed, value="12.5").json()
    assert admin.get(ORDERS).status_code == 200
    assert admin.get(f"{RESULTS}?order={placed}").status_code == 200
    assert (
        admin.post(f"{ORDERS}{placed}/cancel/", {"reason": "no"}, format="json").status_code == 403
    )
    assert admin.post(f"{RESULTS}{result['id']}/review/").status_code == 403


def test_sec_03_orders_results_and_reviews_are_audited(doctor, tech, placed):
    result = record(tech, placed, value="12.5").json()
    doctor.post(f"{RESULTS}{result['id']}/review/")
    resources = set(AuditEntry.objects.values_list("resource", flat=True))
    assert {"diagnostics.order", "diagnostics.result"} <= resources


def test_sec_07_another_organisation_cannot_see_or_use_these_orders(
    placed, make_user, signed_in, tenant_b
):
    outsider = signed_in(make_user("tech-b", tenant_b, [Role.LAB_TECHNICIAN]))
    assert outsider.get(ORDERS).json()["results"] == []
    assert outsider.get(f"{ORDERS}{placed}/").status_code == 404
    assert record(outsider, placed, value="1").status_code == 400
