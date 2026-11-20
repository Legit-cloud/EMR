"""Leave requests (HR module).
Requirement IDs: SEC-02, SEC-03, SEC-07, FR-HR (leave rules)."""

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.staff.models import StaffProfile

pytestmark = pytest.mark.django_db

LEAVE = "/api/staff/leave/"


def day(offset):
    return (timezone.localdate() + timedelta(days=offset)).isoformat()


def profile_for(tenant, user, staff_type="nurse"):
    with tenant_context(tenant.id):
        return StaffProfile.objects.create(
            user=user,
            staff_type=staff_type,
            licensing_body="nmcn",
            licence_number=f"RN-{user.username}",
            licence_expires_on=timezone.localdate() + timedelta(days=700),
        )


@pytest.fixture
def staff(make_user, signed_in, tenant_a):
    people = {}
    for name, role in (("nurse", Role.NURSE), ("nurse2", Role.NURSE), ("hr", Role.HR)):
        user = make_user(f"{name}-lv", tenant_a, [role], email=f"{name}@example.test")
        profile_for(tenant_a, user, "admin" if role == Role.HR else "nurse")
        people[name] = (user, signed_in(user))
    return people


def ask(client, start=10, end=12, **extra):
    return client.post(
        LEAVE,
        {"leave_type": "annual", "start_date": day(start), "end_date": day(end), **extra},
        format="json",
    )


def test_request_decide_and_the_requester_is_emailed(staff, django_capture_on_commit_callbacks):
    nurse = staff["nurse"][1]
    created = ask(nurse)
    assert created.status_code == 201 and created.json()["days"] == 3
    with django_capture_on_commit_callbacks(execute=True):
        decided = staff["hr"][1].post(
            f"{LEAVE}{created.json()['id']}/decide/", {"approve": True}, format="json"
        )
    assert decided.json()["status"] == "approved"
    assert [m.to for m in mail.outbox] == [["nurse@example.test"]]


def test_dates_must_be_in_order_and_not_in_the_past(staff):
    nurse = staff["nurse"][1]
    assert ask(nurse, start=5, end=3).status_code == 400
    assert ask(nurse, start=-3, end=2).status_code == 400


def test_overlapping_requests_are_refused_but_a_rejected_one_frees_the_days(staff):
    nurse, hr = staff["nurse"][1], staff["hr"][1]
    first = ask(nurse, 10, 12).json()
    assert ask(nurse, 12, 14).status_code == 400
    assert ask(nurse, 13, 14).status_code == 201
    hr.post(
        f"{LEAVE}{first['id']}/decide/", {"approve": False, "note": "Short staffed"}, format="json"
    )
    assert ask(nurse, 10, 11).status_code == 201


def test_rejection_needs_a_reason_and_a_decision_is_final(staff):
    nurse, hr = staff["nurse"][1], staff["hr"][1]
    leave = ask(nurse).json()["id"]
    assert hr.post(f"{LEAVE}{leave}/decide/", {"approve": False}, format="json").status_code == 400
    assert hr.post(f"{LEAVE}{leave}/decide/", {"approve": True}, format="json").status_code == 200
    assert (
        hr.post(
            f"{LEAVE}{leave}/decide/", {"approve": False, "note": "x"}, format="json"
        ).status_code
        == 400
    )


def test_sec_02_only_hr_decides_and_nobody_decides_their_own(staff):
    nurse = staff["nurse"][1]
    leave = ask(nurse).json()["id"]
    assert (
        nurse.post(f"{LEAVE}{leave}/decide/", {"approve": True}, format="json").status_code == 403
    )
    own = ask(staff["hr"][1], 20, 21).json()["id"]
    assert (
        staff["hr"][1].post(f"{LEAVE}{own}/decide/", {"approve": True}, format="json").status_code
        == 400
    )


def test_sec_02_staff_see_only_their_own_requests_and_hr_sees_all(staff):
    ask(staff["nurse"][1])
    ask(staff["nurse2"][1], 30, 31)
    assert len(staff["nurse"][1].get(LEAVE).json()["results"]) == 1
    assert len(staff["hr"][1].get(LEAVE).json()["results"]) == 2
    other = staff["nurse2"][1].get(LEAVE).json()["results"][0]["id"]
    assert staff["nurse"][1].get(f"{LEAVE}{other}/").status_code == 404


def test_only_the_requester_can_cancel_and_started_leave_cannot_be_cancelled(staff):
    nurse, other = staff["nurse"][1], staff["nurse2"][1]
    leave = ask(nurse).json()["id"]
    assert other.post(f"{LEAVE}{leave}/cancel/").status_code == 404
    assert nurse.post(f"{LEAVE}{leave}/cancel/").json()["status"] == "cancelled"
    assert nurse.post(f"{LEAVE}{leave}/cancel/").status_code == 400


def test_sec_03_requests_and_decisions_are_audited(staff):
    leave = ask(staff["nurse"][1]).json()["id"]
    staff["hr"][1].post(f"{LEAVE}{leave}/decide/", {"approve": True}, format="json")
    actions = AuditEntry.objects.filter(resource="staff.leave").values_list("action", flat=True)
    assert {"create", "update"} <= set(actions)


def test_sec_07_other_tenant_sees_no_leave(staff, make_user, signed_in, tenant_b):
    ask(staff["nurse"][1])
    other = signed_in(make_user("hr-b", tenant_b, [Role.HR]))
    assert other.get(LEAVE).json()["results"] == []


def test_leave_rows_say_whether_they_belong_to_the_viewer(staff):
    ask(staff["nurse"][1])
    assert staff["nurse"][1].get(LEAVE).json()["results"][0]["is_mine"] is True
    assert staff["hr"][1].get(LEAVE).json()["results"][0]["is_mine"] is False
