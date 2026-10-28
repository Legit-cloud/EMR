"""Data-protection rights in the portal (NDPA 2023, DG-02/03): requests, the privacy notice, and
the patient's own copy of what the portal holds. Requirement IDs: DG-02, DG-03, SEC-02, SEC-03."""

import json
from datetime import timedelta

import pytest
from django.core import mail

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.portal import services
from apps.portal.models import DataSubjectRequest

pytestmark = pytest.mark.django_db

PORTAL = "/api/portal/"
STAFF = "/api/portal/data-requests/"


@pytest.fixture
def compliance(make_user, signed_in, tenant_a):
    return signed_in(
        make_user("dpo", tenant_a, [Role.COMPLIANCE_OFFICER], email="dpo@example.test")
    )


def ask(client, kind="access", details=""):
    return client.post(f"{PORTAL}requests/", {"kind": kind, "details": details}, format="json")


def respond(client, request_id, status="completed", note="A copy of your records was provided."):
    return client.post(
        f"{STAFF}{request_id}/respond/", {"status": status, "note": note}, format="json"
    )


# -- making a request ----------------------------------------------------------------------


def test_dg_03_a_patient_asks_for_their_records_and_everyone_concerned_is_told(
    as_patient, ada, compliance, django_capture_on_commit_callbacks, settings
):
    client, _ = as_patient(ada)
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = ask(client, "access")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "open" and body["kind"] == "access"
    due = services.today() + timedelta(days=settings.DSR_RESPONSE_DAYS)
    assert body["due_on"] == due.isoformat()
    recipients = {m.to[0] for m in mail.outbox}
    assert ada.email in recipients and "dpo@example.test" in recipients
    assert any("received your request" in m.subject for m in mail.outbox)


def test_dg_03_a_correction_says_what_is_wrong_and_only_one_of_a_kind_is_open(as_patient, ada):
    client, _ = as_patient(ada)
    assert ask(client, "correction", "").status_code == 409
    assert ask(client, "correction", "My date of birth is wrong").status_code == 201
    again = ask(client, "correction", "Also my address")
    assert again.status_code == 409
    assert "already have an open request" in again.json()["error"]["message"]
    assert ask(client, "access").status_code == 201  # a different kind is fine
    assert ask(client, "nonsense").status_code == 400


def test_dg_03_a_patient_sees_only_their_own_requests(as_patient, ada, bola):
    ada_client, _ = as_patient(ada)
    bola_client, _ = as_patient(bola)
    ask(ada_client, "access")
    ask(bola_client, "erasure", "I would like my details removed")
    assert [r["kind"] for r in ada_client.get(f"{PORTAL}requests/").json()] == ["access"]
    assert [r["kind"] for r in bola_client.get(f"{PORTAL}requests/").json()] == ["erasure"]


# -- answering -----------------------------------------------------------------------------


def test_dg_03_compliance_answers_and_the_patient_is_told_to_read_it_in_the_portal(
    as_patient, ada, compliance, django_capture_on_commit_callbacks
):
    client, _ = as_patient(ada)
    request_id = ask(client, "access").json()["id"]
    (row,) = compliance.get(STAFF).json()["results"]
    assert (row["patient_name"], row["overdue"]) == ("Ada Okoro", False)
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        answered = respond(compliance, request_id)
    assert answered.status_code == 200
    assert answered.json()["status"] == "completed"
    (message,) = [m for m in mail.outbox if m.to == [ada.email]]
    assert "answered" in message.subject
    assert "copy of your records" not in message.body  # the answer itself is read in the portal
    assert "copy of your records" in client.get(f"{PORTAL}requests/").json()[0]["response_note"]
    assert respond(compliance, request_id, note="Answered a second time.").status_code == 409


def test_dg_03_an_answer_needs_a_reason_and_a_refusal_is_recorded_as_one(
    as_patient, ada, compliance
):
    client, _ = as_patient(ada)
    request_id = ask(client, "erasure", "Delete everything about me").json()["id"]
    assert respond(compliance, request_id, "refused", "no").status_code == 409
    refused = respond(
        compliance,
        request_id,
        "refused",
        "Clinical records must be kept for the legal retention period.",
    )
    assert refused.json()["status"] == "refused"
    assert respond(compliance, request_id, "open", "x" * 20).status_code == 400


def test_dg_03_late_requests_are_marked_overdue_and_come_first(
    as_patient, ada, bola, compliance, tenant_a
):
    for who in (ada, bola):
        ask(as_patient(who)[0], "access")
    with tenant_context(tenant_a.id):
        late = DataSubjectRequest.objects.get(patient=ada)
        DataSubjectRequest.objects.filter(pk=late.pk).update(
            due_on=services.today() - timedelta(days=2)
        )
    rows = compliance.get(STAFF).json()["results"]
    assert rows[0]["overdue"] is True and rows[0]["patient_name"] == "Ada Okoro"
    only_late = compliance.get(STAFF, {"overdue": "true"}).json()
    assert only_late["count"] == 1


def test_sec_02_only_compliance_and_the_admin_use_the_queue_and_patients_cannot(
    as_patient, ada, make_user, signed_in, tenant_a
):
    client, _ = as_patient(ada)
    request_id = ask(client).json()["id"]
    for role, allowed in (
        (Role.COMPLIANCE_OFFICER, True),
        (Role.TENANT_ADMIN, True),
        (Role.DOCTOR, False),
        (Role.FRONT_DESK, False),
        (Role.BILLING_OFFICER, False),
    ):
        staff = signed_in(make_user(f"q-{role}", tenant_a, [role]))
        assert (staff.get(STAFF).status_code == 200) is allowed, role
        assert (respond(staff, request_id).status_code != 403) is allowed, role
    assert client.get(STAFF).status_code == 403  # the patient cannot reach the staff queue


def test_sec_07_another_tenants_compliance_officer_sees_none_of_it(
    as_patient, ada, make_user, signed_in, tenant_b
):
    ask(as_patient(ada)[0])
    outsider = signed_in(make_user("dpo-b", tenant_b, [Role.COMPLIANCE_OFFICER]))
    assert outsider.get(STAFF).json()["count"] == 0


def test_sec_03_making_and_answering_a_request_is_audited(as_patient, ada, compliance, tenant_a):
    client, _ = as_patient(ada)
    request_id = ask(client).json()["id"]
    respond(compliance, request_id)
    with tenant_context(tenant_a.id):
        assert AuditEntry.objects.filter(resource="portal.request", action="create").exists()
        assert AuditEntry.objects.filter(
            resource="portal.request", action="update", object_id=request_id
        ).exists()


# -- the privacy notice and the patient's own copy -----------------------------------------


def test_the_privacy_notice_names_who_is_responsible_and_who_to_contact(as_patient, ada, settings):
    settings.PRIVACY_CONTROLLER_NAME = "St Example Hospital"
    settings.PRIVACY_CONTACT_EMAIL = "privacy@example.test"
    settings.RECORD_RETENTION_YEARS = 12
    client, _ = as_patient(ada)
    notice = client.get(f"{PORTAL}privacy/").json()
    assert notice["controller_name"] == "St Example Hospital"
    assert notice["contact_email"] == "privacy@example.test"
    assert notice["retention_years"] == 12
    assert notice["response_days"] == 30
    assert notice["version"]


def test_the_privacy_notice_falls_back_to_the_organisations_name(
    as_patient, ada, settings, tenant_a
):
    settings.PRIVACY_CONTROLLER_NAME = ""
    client, _ = as_patient(ada)
    assert client.get(f"{PORTAL}privacy/").json()["controller_name"] == tenant_a.name


def test_dg_03_a_patient_downloads_what_the_portal_holds_about_only_themselves(
    as_patient, ada, bola
):
    ada_client, _ = as_patient(ada)
    as_patient(bola)
    ask(ada_client, "access")
    response = ada_client.get(f"{PORTAL}my-information/")
    assert response.status_code == 200
    assert "attachment" in response["Content-Disposition"]
    data = json.loads(response.content)
    assert data["profile"]["first_name"] == "Ada"
    assert [r["kind"] for r in data["requests"]] == ["access"]
    assert "Bola" not in response.content.decode()
    assert set(data) >= {
        "generated_at",
        "notice_version",
        "appointments",
        "prescriptions",
        "invoices",
    }


def test_sec_03_the_download_is_audited_as_an_export(as_patient, ada, tenant_a):
    client, _ = as_patient(ada)
    client.get(f"{PORTAL}my-information/")
    with tenant_context(tenant_a.id):
        entry = AuditEntry.objects.filter(resource="portal.export").latest("sequence")
    assert entry.details == {"export": True}
    assert str(entry.object_id) == str(ada.pk)
