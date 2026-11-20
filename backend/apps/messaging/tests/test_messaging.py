"""Internal staff messaging.
Requirement IDs: SEC-02, SEC-03, SEC-07, DG-01 (no message text in email)."""

import pytest
from django.core import mail

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.messaging.models import Message
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db

THREADS = "/api/messaging/threads/"


@pytest.fixture
def people(make_user, signed_in, tenant_a):
    users = {
        "nurse": make_user("nurse-m", tenant_a, [Role.NURSE]),
        "doctor": make_user("doctor-m", tenant_a, [Role.DOCTOR]),
        "admin": make_user("admin-m", tenant_a, [Role.TENANT_ADMIN]),
    }
    clients = {name: signed_in(user) for name, user in users.items()}
    return users, clients


def start(client, recipients, subject="Bed 4 linen", body="Please send clean linen."):
    return client.post(
        THREADS,
        {"recipients": [str(r.pk) for r in recipients], "subject": subject, "body": body},
        format="json",
    )


def test_a_thread_is_visible_to_its_members_with_unread_counts(people):
    users, clients = people
    created = start(clients["nurse"], [users["doctor"]])
    assert created.status_code == 201
    thread_id = created.json()["id"]
    mine = clients["doctor"].get(THREADS).json()["results"]
    assert mine[0]["id"] == thread_id and mine[0]["unread"] == 1
    opened = clients["doctor"].get(f"{THREADS}{thread_id}/").json()
    assert [m["body"] for m in opened["messages"]] == ["Please send clean linen."]
    assert clients["doctor"].get(THREADS).json()["results"][0]["unread"] == 0
    # The sender's own message is never unread for the sender.
    assert clients["nurse"].get(THREADS).json()["results"][0]["unread"] == 0


def test_reply_adds_a_message_and_marks_the_other_side_unread(people):
    users, clients = people
    thread_id = start(clients["nurse"], [users["doctor"]]).json()["id"]
    clients["doctor"].get(f"{THREADS}{thread_id}/")
    reply = clients["doctor"].post(
        f"{THREADS}{thread_id}/reply/", {"body": "On its way."}, format="json"
    )
    assert reply.status_code == 201
    assert clients["nurse"].get(THREADS).json()["results"][0]["unread"] == 1


def test_sec_02_non_members_cannot_read_or_reply_not_even_the_tenant_admin(people):
    users, clients = people
    thread_id = start(clients["nurse"], [users["doctor"]]).json()["id"]
    assert clients["admin"].get(THREADS).json()["results"] == []
    assert clients["admin"].get(f"{THREADS}{thread_id}/").status_code == 404
    reply = clients["admin"].post(f"{THREADS}{thread_id}/reply/", {"body": "x"}, format="json")
    assert reply.status_code == 404


def test_recipients_must_be_active_staff_of_the_same_tenant(people, make_user, tenant_a, tenant_b):
    users, clients = people
    patient = make_user("pat-m", tenant_a, [Role.PATIENT])
    stranger = make_user("doc-b", tenant_b, [Role.DOCTOR])
    assert start(clients["nurse"], [patient]).status_code == 400
    assert start(clients["nurse"], [stranger]).status_code == 400
    assert start(clients["nurse"], [users["nurse"]]).status_code == 400


def test_empty_subject_or_body_is_refused(people):
    users, clients = people
    assert start(clients["nurse"], [users["doctor"]], subject=" ").status_code == 400
    assert start(clients["nurse"], [users["doctor"]], body=" ").status_code == 400


def test_dg_01_email_says_a_message_is_waiting_but_not_what_it_says(
    people, tenant_a, django_capture_on_commit_callbacks
):
    users, clients = people
    with django_capture_on_commit_callbacks(execute=True):
        start(clients["nurse"], [users["doctor"]], body="Mrs Obi in bed 4 is worse")
    with tenant_context(tenant_a.id):
        assert Notification.objects.filter(purpose="staff_message").count() == 1
    assert len(mail.outbox) == 1
    assert all("Obi" not in m.body and "bed 4" not in m.body.lower() for m in mail.outbox)


def test_sec_03_writes_are_audited(people):
    users, clients = people
    start(clients["nurse"], [users["doctor"]])
    assert AuditEntry.objects.filter(resource="messaging.thread", action="create").exists()


def test_sec_07_other_tenant_sees_nothing(people, make_user, signed_in, tenant_b):
    users, clients = people
    thread_id = start(clients["nurse"], [users["doctor"]]).json()["id"]
    other = signed_in(make_user("doc-b2", tenant_b, [Role.DOCTOR]))
    assert other.get(THREADS).json()["results"] == []
    assert other.get(f"{THREADS}{thread_id}/").status_code == 404


def test_messages_stay_after_the_thread_is_read(people, tenant_a):
    users, clients = people
    start(clients["nurse"], [users["doctor"]])
    with tenant_context(tenant_a.id):
        assert Message.objects.count() == 1
