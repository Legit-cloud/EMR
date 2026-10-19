"""Patient-level break-glass (SEC-02, SEC-03): one reason opens a patient's clinical
records outside the clinician's scope, for viewing only, for a limited time, logged."""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import BreakGlassGrant
from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.patients.models import Patient

pytestmark = pytest.mark.django_db

REASON = "Collapsed in clinic; surgical history needed now"


@pytest.fixture
def surgery_encounter(make_encounter):
    # The doctor works in medicine; this encounter is in surgery, outside their scope.
    return make_encounter(department="surgery")


def open_patient(client, patient, reason=REASON):
    return client.post(
        "/api/accounts/break-glass/",
        {"resource": "patients.patient", "object_id": str(patient.id), "reason": reason},
        format="json",
    )


def status_of(client, patient):
    return client.get(f"/api/accounts/break-glass/patients/{patient.id}/")


def test_sec_02_out_of_scope_record_offers_patient_break_glass(doctor, surgery_encounter, patient):
    response = doctor.get(f"/api/clinical/encounters/{surgery_encounter.id}/")
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "break_glass_available"
    assert error["details"] == {"resource": "patients.patient", "object_id": str(patient.id)}
    denied = AuditEntry.objects.get(outcome="denied", object_id=str(surgery_encounter.id))
    assert denied.reason == "break_glass_available"


def test_sec_02_status_reports_hidden_records_and_no_grant(doctor, surgery_encounter, patient):
    body = status_of(doctor, patient).json()
    assert body == {
        "patient": str(patient.id),
        "hidden_records": True,
        "can_break_glass": True,
        "grant": None,
    }


def test_sec_02_nothing_hidden_when_every_record_is_in_scope(doctor, encounter, patient):
    assert status_of(doctor, patient).json()["hidden_records"] is False


def test_sec_03_patient_grant_opens_the_chart_and_every_read_is_logged(
    doctor, surgery_encounter, encounter, patient
):
    list_url = f"/api/clinical/encounters/?patient={patient.id}"
    assert {e["id"] for e in doctor.get(list_url).json()["results"]} == {str(encounter.id)}

    assert open_patient(doctor, patient).status_code == 201
    grant = BreakGlassGrant.all_tenants.get()
    assert grant.resource == "patients.patient" and grant.object_id == str(patient.id)

    listed = {e["id"] for e in doctor.get(list_url).json()["results"]}
    assert listed == {str(encounter.id), str(surgery_encounter.id)}
    list_read = AuditEntry.objects.filter(action="read", reason="break_glass").get()
    assert list_read.details["break_glass_grant_ids"] == [str(grant.id)]

    assert doctor.get(f"/api/clinical/encounters/{surgery_encounter.id}/").status_code == 200
    detail_read = AuditEntry.objects.get(action="read", object_id=str(surgery_encounter.id))
    assert detail_read.reason == "break_glass"
    assert detail_read.details["break_glass_grant_id"] == str(grant.id)

    body = status_of(doctor, patient).json()
    assert body["grant"]["id"] == str(grant.id) and body["grant"]["reason"] == REASON


def test_sec_02_in_scope_list_reads_are_not_tagged_as_break_glass(doctor, encounter, patient):
    open_patient(doctor, patient)
    doctor.get(f"/api/clinical/encounters/?patient={patient.id}")
    assert not AuditEntry.objects.filter(action="read", reason="break_glass").exists()


def test_sec_02_patient_grant_is_for_viewing_only(doctor, surgery_encounter, patient):
    open_patient(doctor, patient)
    response = doctor.patch(
        f"/api/clinical/encounters/{surgery_encounter.id}/", {"reason": "edited"}, format="json"
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_sec_02_patient_grant_expires(doctor, surgery_encounter, patient):
    open_patient(doctor, patient)
    BreakGlassGrant.all_tenants.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert doctor.get(f"/api/clinical/encounters/{surgery_encounter.id}/").status_code == 403
    assert status_of(doctor, patient).json()["grant"] is None


def test_sec_02_patient_grant_covers_only_that_patient(
    doctor, make_encounter, patient, tenant_a, as_tenant
):
    with as_tenant(tenant_a):
        other = Patient.objects.create(
            first_name="Bola", last_name="Ade", date_of_birth=date(1990, 1, 1), sex="male"
        )
    theirs = make_encounter(department="surgery", patient=other)
    open_patient(doctor, patient)
    assert doctor.get(f"/api/clinical/encounters/{theirs.id}/").status_code == 403


def test_sec_02_roles_without_break_glass_get_a_plain_denial(
    make_user, tenant_a, org, signed_in, surgery_encounter, patient
):
    clerk = signed_in(make_user("clerk", tenant_a, [Role.FRONT_DESK]))
    response = clerk.get(f"/api/clinical/encounters/{surgery_encounter.id}/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"
    body = status_of(clerk, patient).json()
    assert body["can_break_glass"] is False and body["hidden_records"] is False
    assert open_patient(clerk, patient).status_code == 403


def test_sec_07_status_is_404_for_another_tenants_patient(doctor, tenant_b, as_tenant):
    with as_tenant(tenant_b):
        stranger = Patient.objects.create(
            first_name="Ife", last_name="Obi", date_of_birth=date(1970, 3, 3), sex="female"
        )
    assert status_of(doctor, stranger).status_code == 404


def test_me_lists_the_attributes_the_web_app_uses(doctor, doctor_user, org):
    body = doctor.get("/api/accounts/auth/me/").json()
    assert body["roles"] == ["doctor"]
    assert body["assignments"] == [
        {
            "role": "doctor",
            "facility": str(org["facility"].id),
            "department": str(org["medicine"].id),
        }
    ]
    assert body["on_duty"] is False
    assert body["can_break_glass"] is True
