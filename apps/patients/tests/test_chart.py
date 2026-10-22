"""Status changes and the Deceased cascade, Entered-in-Error, allergies and attachments."""

import logging
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from storages.backends.s3 import S3Storage

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.patients import selectors
from apps.patients.models import Attachment, Patient

from .conftest import ADA

pytestmark = pytest.mark.django_db

PATIENTS = "/api/patients/patients/"
ALLERGIES = "/api/patients/allergies/"
ATTACHMENTS = "/api/patients/attachments/"
PDF = b"%PDF-1.7\n% synthetic test document\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


# -- status and the Deceased cascade -----------------------------------------------


def set_status(client, patient, **data):
    return client.post(f"{PATIENTS}{patient.pk}/status/", data, format="json")


def test_deceased_publishes_one_event_handled_by_every_module(
    doctor, make_patient, caplog, django_capture_on_commit_callbacks
):
    patient = make_patient()
    caplog.set_level(logging.INFO)
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        response = set_status(doctor, patient, status="deceased", deceased_at="2026-01-05")
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "deceased"
    assert len(callbacks) == 1
    handled = [r.getMessage() for r in caplog.records if "patient.deceased" in r.getMessage()]
    assert len(handled) == 3
    for module_message in (
        "cancelled 0 appointment(s)",
        "flagged 0 invoice(s)",
        "revoked 0 portal account(s)",
    ):
        assert any(module_message in m and str(patient.pk) in m for m in handled)


def test_deceased_needs_a_valid_date(doctor, make_patient):
    patient = make_patient()
    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    for bad in ({}, {"deceased_at": tomorrow}, {"deceased_at": "1980-01-01"}):
        response = set_status(doctor, patient, status="deceased", **bad)
        assert response.status_code == 400, bad
        assert "deceased_at" in response.json()["error"]["details"]


def test_only_clinical_roles_can_record_a_death(clerk, make_patient):
    response = set_status(clerk, make_patient(), status="deceased", deceased_at="2026-01-05")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "status_change_refused"


def test_deceased_patient_cannot_be_reactivated(doctor, make_patient):
    patient = make_patient()
    set_status(doctor, patient, status="deceased", deceased_at="2026-01-05")
    assert set_status(doctor, patient, status="active").status_code == 409


def test_inactive_and_back_publishes_nothing(
    doctor, make_patient, django_capture_on_commit_callbacks
):
    patient = make_patient()
    with django_capture_on_commit_callbacks() as callbacks:
        assert set_status(doctor, patient, status="inactive").json()["status"] == "inactive"
        assert set_status(doctor, patient, status="active").json()["status"] == "active"
    assert callbacks == []


# -- Entered-in-Error --------------------------------------------------------------


def test_entered_in_error_hides_but_never_deletes(clerk, make_patient):
    patient = make_patient()
    url = f"{PATIENTS}{patient.pk}/"
    assert clerk.delete(url).status_code == 405
    response = clerk.post(f"{url}entered-in-error/", {"reason": "Registered twice"}, format="json")
    assert response.json()["record_state"] == "entered_in_error"
    assert clerk.get(PATIENTS).json()["results"] == []
    history = clerk.get(PATIENTS, {"history": "true"}).json()["results"]
    assert [p["id"] for p in history] == [str(patient.pk)]
    assert clerk.get(url).status_code == 200  # still readable as history
    assert Patient.all_tenants.filter(pk=patient.pk).exists()
    assert AuditEntry.objects.filter(action="delete", object_id=str(patient.pk)).exists()


def test_entered_in_error_needs_a_reason(clerk, make_patient):
    patient = make_patient()
    response = clerk.post(f"{PATIENTS}{patient.pk}/entered-in-error/", {}, format="json")
    assert response.status_code == 400


# -- allergies ---------------------------------------------------------------------


def allergy(patient, **overrides):
    return {
        "patient": str(patient.pk),
        "substance": "Penicillin",
        "category": "medication",
        "reaction": "Hives",
        "severity": "severe",
        **overrides,
    }


def test_allergies_are_structured_and_feed_the_interaction_check(
    doctor, make_patient, tenant_a, as_tenant
):
    patient = make_patient()
    assert doctor.post(ALLERGIES, allergy(patient), format="json").status_code == 201
    wrong = doctor.post(ALLERGIES, allergy(patient, substance="Latex"), format="json").json()
    doctor.post(
        f"{ALLERGIES}{wrong['id']}/entered-in-error/", {"reason": "Wrong patient"}, format="json"
    )
    listed = doctor.get(ALLERGIES, {"patient": str(patient.pk)}).json()["results"]
    assert [a["substance"] for a in listed] == ["Penicillin"]
    with as_tenant(tenant_a):
        active = selectors.active_allergies(patient.pk)
    assert [(a["substance"], a["severity"]) for a in active] == [("Penicillin", "severe")]


def test_allergy_severity_must_be_a_known_value(doctor, make_patient):
    response = doctor.post(ALLERGIES, allergy(make_patient(), severity="extreme"), format="json")
    assert response.status_code == 400


def test_allergy_cannot_be_attached_to_another_tenants_patient(doctor, make_patient, tenant_b):
    foreign = make_patient(tenant=tenant_b)
    assert doctor.post(ALLERGIES, allergy(foreign), format="json").status_code == 400


def test_front_desk_cannot_see_allergies(clerk):
    assert clerk.get(ALLERGIES).status_code == 403


# -- attachments -------------------------------------------------------------------


def upload(
    client,
    patient,
    content=PDF,
    name="Referral letter for Adaeze.pdf",
    content_type="application/pdf",
):
    return client.post(
        ATTACHMENTS,
        {
            "patient": str(patient.pk),
            "category": "referral",
            "file": SimpleUploadedFile(name, content, content_type=content_type),
        },
        format="multipart",
    )


def test_upload_stores_privately_without_the_original_name_in_the_key(clerk, make_patient):
    patient = make_patient()
    response = upload(clerk, patient)
    assert response.status_code == 201, response.json()
    attachment = Attachment.all_tenants.get()
    assert "Adaeze" not in attachment.file.name
    assert attachment.file.name.startswith(f"tenants/{patient.tenant_id}/patients/{patient.pk}/")
    assert attachment.original_name == "Referral letter for Adaeze.pdf"
    assert "file" not in response.json()  # no direct file URL in responses


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b"MZ\x90\x00executable", "application/x-msdownload"),
        (b"MZ\x90\x00executable", "application/pdf"),  # lies about its type
        (b"<svg></svg>", "image/svg+xml"),
    ],
)
def test_upload_rejects_disallowed_or_disguised_files(clerk, make_patient, content, content_type):
    response = upload(clerk, make_patient(), content=content, content_type=content_type)
    assert response.status_code == 400


def test_upload_rejects_oversized_files(clerk, make_patient, settings):
    settings.PATIENT_ATTACHMENT_MAX_BYTES = 10
    response = upload(clerk, make_patient(), content=PNG, name="scan.png", content_type="image/png")
    assert response.status_code == 400


def test_download_returns_a_short_lived_url_and_is_audited(clerk, doctor, make_patient):
    patient = make_patient()
    attachment_id = upload(clerk, patient).json()["id"]
    response = doctor.get(f"{ATTACHMENTS}{attachment_id}/download/")
    assert response.status_code == 200
    assert response.json()["expires_in"] == 300
    read = AuditEntry.objects.get(action="read", resource="patients.attachment")
    assert read.object_id == attachment_id


def test_sec_05_production_storage_issues_signed_expiring_urls():
    storage = S3Storage(
        bucket_name="emr-private",
        access_key="dummy-access-key",
        secret_key="dummy-secret-key",
        region_name="us-east-1",
        querystring_auth=True,
        querystring_expire=300,
        default_acl=None,
        signature_version="s3v4",
    )
    url = storage.url("tenants/t/patients/p/file.pdf")
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=300" in url


def test_attachments_cannot_be_overwritten_or_deleted(clerk, make_patient):
    attachment_id = upload(clerk, make_patient()).json()["id"]
    assert clerk.delete(f"{ATTACHMENTS}{attachment_id}/").status_code == 405
    assert clerk.patch(f"{ATTACHMENTS}{attachment_id}/", {}, format="json").status_code == 405


def test_sec_02_pharmacist_cannot_open_attachments(
    make_user, tenant_a, signed_in, clerk, make_patient
):
    attachment_id = upload(clerk, make_patient()).json()["id"]
    pharmacist = signed_in(make_user("pharm", tenant_a, [Role.PHARMACIST]))
    assert pharmacist.get(f"{ATTACHMENTS}{attachment_id}/download/").status_code == 403


def test_birth_date_before_1880_is_rejected(clerk):
    response = clerk.post(PATIENTS, {**ADA, "date_of_birth": "1850-01-01"}, format="json")
    assert response.status_code == 400
