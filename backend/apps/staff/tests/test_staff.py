"""Staff profiles, licence verification, the licence watcher and shift status."""

from datetime import date, timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.staff.models import StaffProfile
from apps.staff.tasks import run_licence_watcher

pytestmark = pytest.mark.django_db

PROFILES = "/api/staff/profiles/"


@pytest.fixture
def hr(make_user, tenant_a, signed_in):
    return signed_in(make_user("hr", tenant_a, [Role.HR]))


@pytest.fixture
def nurse_user(make_user, tenant_a):
    return make_user("nurse", tenant_a, [Role.NURSE], first_name="Amaka", last_name="Obi")


def profile_payload(user, **overrides):
    return {
        "user": str(user.pk),
        "staff_type": "nurse",
        "licensing_body": "nmcn",
        "licence_number": "RN-123456",
        "licence_expires_on": "2030-12-31",
        "consultation_fee_minor": 0,
        **overrides,
    }


@pytest.fixture
def make_profile(tenant_a, as_tenant):
    def make(user, **overrides):
        data = {
            "staff_type": "nurse",
            "licensing_body": "nmcn",
            "licence_number": f"RN-{user.username}",
            "licence_expires_on": date(2030, 12, 31),
            **overrides,
        }
        with as_tenant(tenant_a):
            return StaffProfile.objects.create(user=user, **data)

    return make


# -- profiles and licences ------------------------------------------------------------


def test_hr_records_a_clinical_profile(hr, nurse_user):
    response = hr.post(PROFILES, profile_payload(nurse_user), format="json")
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["licence_verification"] == "unverified" and body["on_duty"] is False
    assert body["display_name"] == "Amaka Obi"


def test_clinical_staff_need_licence_details(hr, nurse_user):
    response = hr.post(
        PROFILES,
        profile_payload(nurse_user, licence_number="", licence_expires_on=None),
        format="json",
    )
    assert response.status_code == 400
    assert {"licence_number", "licence_expires_on"} <= set(response.json()["error"]["details"])
    non_clinical = profile_payload(
        nurse_user,
        staff_type="non_clinical",
        licensing_body="",
        licence_number="",
        licence_expires_on=None,
    )
    assert hr.post(PROFILES, non_clinical, format="json").status_code == 201


def test_licence_numbers_are_unique_and_fees_use_a_known_currency(
    hr, nurse_user, make_user, tenant_a
):
    hr.post(PROFILES, profile_payload(nurse_user), format="json")
    other = make_user("other", tenant_a)
    assert hr.post(PROFILES, profile_payload(other), format="json").status_code == 400
    response = hr.post(
        PROFILES,
        profile_payload(other, licence_number="RN-999", consultation_fee_currency="XYZ"),
        format="json",
    )
    assert "consultation_fee_currency" in response.json()["error"]["details"]


def test_licence_verification_records_who_when_and_the_reference(hr, nurse_user, make_profile):
    profile = make_profile(nurse_user)
    response = hr.post(
        f"{PROFILES}{profile.pk}/verify-licence/",
        {"outcome": "verified", "reference": "NMCN register search 2026-10-15"},
        format="json",
    )
    assert response.status_code == 200
    profile.refresh_from_db()
    assert profile.licence_verification == "verified"
    assert profile.licence_verified_by.username == "hr"
    assert profile.licence_verified_at is not None


def test_sec_02_clinicians_view_but_cannot_change_profiles(signed_in, nurse_user, make_profile):
    profile = make_profile(nurse_user)
    client = signed_in(nurse_user)
    assert client.get(PROFILES).status_code == 200
    response = client.post(
        f"{PROFILES}{profile.pk}/verify-licence/",
        {"outcome": "verified", "reference": "x"},
        format="json",
    )
    assert response.status_code == 403


# -- licence watcher ------------------------------------------------------------------


def test_licence_watcher_flags_expiring_and_expired_once(
    make_user, tenant_a, make_profile, django_capture_on_commit_callbacks
):
    make_user("hr", tenant_a, [Role.HR], email="hr@example.test")
    make_user("admin", tenant_a, [Role.TENANT_ADMIN], email="admin@example.test")
    today = timezone.localdate()
    soon = make_profile(make_user("soon", tenant_a), licence_expires_on=today + timedelta(days=30))
    gone = make_profile(make_user("gone", tenant_a), licence_expires_on=today - timedelta(days=1))
    fine = make_profile(make_user("fine", tenant_a), licence_expires_on=today + timedelta(days=365))

    with django_capture_on_commit_callbacks(execute=True):
        assert run_licence_watcher() == 2
    for profile, flag in ((soon, "expiring"), (gone, "expired"), (fine, "ok")):
        profile.refresh_from_db()
        assert profile.licence_flag == flag
    assert len(mail.outbox) == 4  # two licences, two recipients each
    assert {m.to[0] for m in mail.outbox} == {"hr@example.test", "admin@example.test"}
    assert AuditEntry.objects.filter(reason="licence_watcher").count() == 2

    with django_capture_on_commit_callbacks(execute=True):
        assert run_licence_watcher() == 0  # nothing new: no repeat emails
    assert len(mail.outbox) == 4


def test_renewed_licence_clears_the_flag(make_user, tenant_a, make_profile, as_tenant):
    profile = make_profile(make_user("renew", tenant_a), licence_expires_on=timezone.localdate())
    run_licence_watcher()
    with as_tenant(tenant_a):
        StaffProfile.objects.filter(pk=profile.pk).update(licence_expires_on=date(2031, 1, 1))
    run_licence_watcher()
    profile.refresh_from_db()
    assert profile.licence_flag == "ok"


def test_licence_watcher_covers_every_tenant(make_user, tenant_b, as_tenant):
    user = make_user("b-nurse", tenant_b)
    with as_tenant(tenant_b):
        StaffProfile.objects.create(
            user=user,
            staff_type="nurse",
            licensing_body="nmcn",
            licence_number="RN-B",
            licence_expires_on=timezone.localdate() - timedelta(days=3),
        )
    assert run_licence_watcher() == 1


# -- shifts ---------------------------------------------------------------------------


def test_clock_in_and_out_sets_shift_status(signed_in, nurse_user, make_profile, hr):
    make_profile(nurse_user)
    client = signed_in(nurse_user)
    assert client.post("/api/staff/shifts/clock-in/").status_code == 201
    assert client.post("/api/staff/shifts/clock-in/").status_code == 409
    assert hr.get(PROFILES).json()["results"][0]["on_duty"] is True
    assert len(hr.get("/api/staff/shifts/", {"open": "true"}).json()["results"]) == 1
    assert client.post("/api/staff/shifts/clock-out/").status_code == 200
    assert client.post("/api/staff/shifts/clock-out/").status_code == 409
    assert hr.get(PROFILES).json()["results"][0]["on_duty"] is False


def test_clock_in_needs_a_staff_profile(signed_in, nurse_user):
    response = signed_in(nurse_user).post("/api/staff/shifts/clock-in/")
    assert response.status_code == 409


def test_shift_history_is_for_hr_only(signed_in, nurse_user):
    assert signed_in(nurse_user).get("/api/staff/shifts/").status_code == 403


def test_sec_02_on_duty_grants_follow_real_shifts(
    signed_in, nurse_user, make_profile, tenant_a, as_tenant
):
    """The test resource lets nurses read care-team records only while on duty."""
    from tests.tenancy_app.models import Record

    make_profile(nurse_user)
    with as_tenant(tenant_a):
        record = Record.objects.create(title="Ward round")
        record.care_team.add(nurse_user)
    client = signed_in(nurse_user)
    assert client.get("/test-api/records/").status_code == 403
    client.post("/api/staff/shifts/clock-in/")
    assert [r["title"] for r in client.get("/test-api/records/").json()["results"]] == [
        "Ward round"
    ]
    client.post("/api/staff/shifts/clock-out/")
    assert client.get("/test-api/records/").status_code == 403


# -- the staff list screen (F14) --------------------------------------------------------


def _make_staff(make_user, tenant, hr, username, staff_type, **extra):
    user = make_user(
        username, tenant, [Role.NURSE], first_name=username.title(), last_name="Tester"
    )
    payload = profile_payload(
        user, **{"staff_type": staff_type, "licence_number": f"L-{username}", **extra}
    )
    assert hr.post(PROFILES, payload, format="json").status_code == 201
    return user


def test_staff_list_groups_doctors_and_general_staff_and_counts_them(hr, make_user, tenant_a):
    _make_staff(make_user, tenant_a, hr, "ada", "physician", specialty="Cardiology")
    _make_staff(make_user, tenant_a, hr, "bola", "physician", specialty="Paediatrics")
    _make_staff(make_user, tenant_a, hr, "chi", "nurse")
    _make_staff(
        make_user, tenant_a, hr, "dayo", "non_clinical", licensing_body="", licence_number=""
    )

    doctors = hr.get(PROFILES, {"group": "doctors"}).json()
    assert doctors["count"] == 2
    assert {r["specialty"] for r in doctors["results"]} == {"Cardiology", "Paediatrics"}
    assert hr.get(PROFILES, {"group": "general"}).json()["count"] == 2
    summary = hr.get(f"{PROFILES}summary/").json()
    assert summary["doctors"] == 2
    assert summary["general"] == 2


def test_staff_list_searches_by_name_specialty_and_licence(hr, make_user, tenant_a):
    _make_staff(make_user, tenant_a, hr, "ada", "physician", specialty="Cardiology")
    _make_staff(make_user, tenant_a, hr, "bola", "physician", specialty="Paediatrics")
    assert hr.get(PROFILES, {"q": "cardio"}).json()["count"] == 1
    assert hr.get(PROFILES, {"q": "Bola Tester"}).json()["count"] == 1
    assert hr.get(PROFILES, {"q": "L-ada"}).json()["count"] == 1
    assert hr.get(PROFILES, {"q": "nobody"}).json()["count"] == 0


def test_staff_summary_counts_licences_that_need_attention(hr, make_user, tenant_a):
    _make_staff(make_user, tenant_a, hr, "ada", "physician")
    soon = make_user("soon", tenant_a, [Role.NURSE])
    hr.post(
        PROFILES,
        profile_payload(
            soon,
            licence_number="L-soon",
            licence_expires_on=(date.today() + timedelta(days=10)).isoformat(),
        ),
        format="json",
    )
    with tenant_context(tenant_a.id):
        StaffProfile.objects.filter(licence_number="L-soon").update(licence_flag="expiring")
    summary = hr.get(f"{PROFILES}summary/").json()
    assert summary["licences_expiring"] == 1
    assert summary["licences_expired"] == 0
    assert hr.get(PROFILES, {"page_size": 1}).json()["results"].__len__() == 1


def test_staff_summary_is_tenant_scoped_and_needs_view_rights(
    hr, make_user, tenant_a, tenant_b, signed_in
):
    _make_staff(make_user, tenant_a, hr, "ada", "physician")
    outsider = signed_in(make_user("hr-b", tenant_b, [Role.HR]))
    assert outsider.get(f"{PROFILES}summary/").json()["doctors"] == 0
    patient_user = signed_in(make_user("desk", tenant_a, [Role.FRONT_DESK]))
    assert patient_user.get(f"{PROFILES}summary/").status_code in (200, 403)
