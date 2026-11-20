"""Self-service sign-up and onboarding.
Requirement IDs: SEC-02, SEC-03, SEC-06, SEC-07, DG-02 (terms recorded), DG-01 (no leaks)."""

import re

import pytest
from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import RoleAssignment, User
from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.onboarding.models import OnboardingProfile, Signup
from apps.tenants.models import Department, Facility, Tenant

pytestmark = pytest.mark.django_db

SIGNUP = "/api/onboarding/signup/"
VERIFY = "/api/onboarding/signup/verify/"
RESEND = "/api/onboarding/signup/resend/"
PROFILE = "/api/onboarding/profile/"
PASSWORD = "A-long-synthetic-passphrase-42"

FORM = {
    "organisation_name": "Sunrise Clinic",
    "first_name": "Ada",
    "last_name": "Obi",
    "email": "Ada@Sunrise.example.test",
    "password": PASSWORD,
    "accepted_terms": True,
}


@pytest.fixture
def client():
    return APIClient(enforce_csrf_checks=False)


def code_sent_to(address):
    """The six-digit code from the latest email to ``address``."""
    for message in reversed(mail.outbox):
        if address in message.to:
            found = re.search(r"\b(\d{6})\b", message.body)
            if found:
                return found.group(1)
    raise AssertionError("no code emailed")


def signup(client, **changes):
    return client.post(SIGNUP, {**FORM, **changes}, format="json")


def verified_client(django_capture_on_commit_callbacks):
    client = APIClient()
    with django_capture_on_commit_callbacks(execute=True):
        assert signup(client).status_code == 202
    response = client.post(
        VERIFY,
        {"email": FORM["email"], "code": code_sent_to("ada@sunrise.example.test")},
        format="json",
    )
    assert response.status_code == 200, response.content
    return client


def test_signup_emails_a_code_and_creates_nothing_yet(client, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = signup(client)
    assert response.status_code == 202 and response.json() == {"email": "ada@sunrise.example.test"}
    assert Signup.objects.count() == 1 and Tenant.objects.count() == 0 and User.objects.count() == 0
    assert len(code_sent_to("ada@sunrise.example.test")) == 6


def test_the_code_and_password_are_stored_hashed(client, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        signup(client)
    row = Signup.objects.get()
    assert PASSWORD not in row.password_hash and code_sent_to(row.email) not in row.code_hash


def test_verifying_creates_the_organisation_admin_and_a_session(django_capture_on_commit_callbacks):
    client = verified_client(django_capture_on_commit_callbacks)
    tenant = Tenant.objects.get()
    assert tenant.name == "Sunrise Clinic" and tenant.slug == "sunrise-clinic"
    user = User.objects.get()
    assert user.username == "ada@sunrise.example.test" and user.tenant_id == tenant.id
    assert user.check_password(PASSWORD)
    with tenant_context(tenant.id):
        assert RoleAssignment.objects.get(user=user).role == Role.TENANT_ADMIN
        assert Facility.objects.count() == 1
        assert OnboardingProfile.objects.get().completed_at is None
    assert Signup.objects.count() == 0
    me = client.get("/api/accounts/auth/me/")
    assert me.status_code == 200 and me.json()["roles"] == ["tenant_admin"]


def test_dg_02_acceptance_of_the_terms_is_required_and_recorded(
    client, django_capture_on_commit_callbacks
):
    assert signup(client, accepted_terms=False).status_code == 400
    assert Signup.objects.count() == 0
    client = verified_client(django_capture_on_commit_callbacks)
    entry = AuditEntry.objects.get(resource="onboarding.signup")
    assert "terms_accepted_at" in entry.details


def test_weak_passwords_are_refused(client):
    assert signup(client, password="short").status_code == 400
    assert signup(client, password="12345678901234").status_code == 400
    assert Signup.objects.count() == 0


def test_a_wrong_code_is_refused_and_five_wrong_guesses_lock_the_request(
    client, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        signup(client)
    good = code_sent_to("ada@sunrise.example.test")
    bad = "000000" if good != "000000" else "111111"
    for _ in range(5):
        assert (
            client.post(VERIFY, {"email": FORM["email"], "code": bad}, format="json").status_code
            == 400
        )
    locked = client.post(VERIFY, {"email": FORM["email"], "code": good}, format="json")
    assert locked.status_code == 400 and Tenant.objects.count() == 0


def test_an_expired_code_is_refused(client, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        signup(client)
    from datetime import timedelta

    from django.utils import timezone

    Signup.objects.update(code_expires_at=timezone.now() - timedelta(seconds=1))
    response = client.post(
        VERIFY,
        {"email": FORM["email"], "code": code_sent_to("ada@sunrise.example.test")},
        format="json",
    )
    assert response.status_code == 400 and Tenant.objects.count() == 0


def test_a_code_works_once(client, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        signup(client)
    body = {"email": FORM["email"], "code": code_sent_to("ada@sunrise.example.test")}
    assert client.post(VERIFY, body, format="json").status_code == 200
    assert APIClient().post(VERIFY, body, format="json").status_code == 400
    assert Tenant.objects.count() == 1


def test_dg_01_an_existing_address_gets_the_same_answer_and_an_email_not_a_second_account(
    client, make_user, tenant_a, django_capture_on_commit_callbacks
):
    make_user("existing", tenant_a, [Role.DOCTOR], email="ada@sunrise.example.test")
    with django_capture_on_commit_callbacks(execute=True):
        response = signup(client)
    assert response.status_code == 202 and response.json() == {"email": "ada@sunrise.example.test"}
    assert Signup.objects.count() == 0
    assert any("already have an account" in m.subject for m in mail.outbox)


def test_resend_replaces_the_code_and_resets_the_tries(client, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        signup(client)
    first = code_sent_to("ada@sunrise.example.test")
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(RESEND, {"email": FORM["email"]}, format="json").status_code == 202
    second = code_sent_to("ada@sunrise.example.test")
    body = {"email": FORM["email"], "code": second}
    if first != second:
        assert client.post(VERIFY, {**body, "code": first}, format="json").status_code == 400
    assert client.post(VERIFY, body, format="json").status_code == 200


def test_resend_for_an_unknown_address_is_silent(client):
    assert client.post(RESEND, {"email": "nobody@example.test"}, format="json").status_code == 202
    assert mail.outbox == []


@override_settings(SELF_SIGNUP_ENABLED=False)
def test_signup_can_be_closed(client):
    assert signup(client).status_code == 403


def test_sec_06_signup_requires_the_csrf_token(db):
    strict = APIClient(enforce_csrf_checks=True)
    assert strict.post(SIGNUP, FORM, format="json").status_code == 403


def test_two_organisations_with_the_same_name_get_different_slugs(
    django_capture_on_commit_callbacks,
):
    verified_client(django_capture_on_commit_callbacks)
    other = APIClient()
    with django_capture_on_commit_callbacks(execute=True):
        signup(other, email="bola@sunrise.example.test")
    other.post(
        VERIFY,
        {"email": "bola@sunrise.example.test", "code": code_sent_to("bola@sunrise.example.test")},
        format="json",
    )
    assert sorted(Tenant.objects.values_list("slug", flat=True)) == [
        "sunrise-clinic",
        "sunrise-clinic-2",
    ]


# -- the questions ------------------------------------------------------------------------

ANSWERS = {
    "facility_name": "Sunrise Clinic, Yaba",
    "facility_type": "clinic",
    "phone": "+2348012345678",
    "staff_band": "11-50",
    "bed_band": "none",
    "city": "Lagos",
    "departments": ["Outpatient (OPD)", "Pharmacy"],
    "modules": ["appointments", "billing"],
}


def test_current_shows_the_questions_and_choices(django_capture_on_commit_callbacks):
    client = verified_client(django_capture_on_commit_callbacks)
    body = client.get(f"{PROFILE}current/").json()
    assert body["complete"] is False and body["organisation_name"] == "Sunrise Clinic"
    assert "Pharmacy" in body["department_choices"] and "billing" in body["module_choices"]


def test_answers_save_in_steps_and_are_validated(django_capture_on_commit_callbacks):
    client = verified_client(django_capture_on_commit_callbacks)
    assert (
        client.post(f"{PROFILE}save/", {"phone": "08012345678"}, format="json").status_code == 400
    )
    assert (
        client.post(f"{PROFILE}save/", {"facility_type": "zoo"}, format="json").status_code == 400
    )
    assert (
        client.post(f"{PROFILE}save/", {"departments": ["Time travel"]}, format="json").status_code
        == 400
    )
    saved = client.post(
        f"{PROFILE}save/", {"facility_type": "clinic", "city": "Lagos"}, format="json"
    )
    assert saved.status_code == 200 and saved.json()["city"] == "Lagos"
    assert client.get(f"{PROFILE}current/").json()["facility_type"] == "clinic"


def test_finishing_needs_the_required_answers(django_capture_on_commit_callbacks):
    client = verified_client(django_capture_on_commit_callbacks)
    assert client.post(f"{PROFILE}finish/").status_code == 400
    assert client.get(f"{PROFILE}current/").json()["complete"] is False


def test_finishing_names_the_facility_creates_departments_and_is_repeatable(
    django_capture_on_commit_callbacks,
):
    client = verified_client(django_capture_on_commit_callbacks)
    client.post(f"{PROFILE}save/", ANSWERS, format="json")
    done = client.post(f"{PROFILE}finish/")
    assert done.status_code == 200 and done.json()["complete"] is True
    assert client.post(f"{PROFILE}finish/").status_code == 200
    tenant = Tenant.objects.get()
    with tenant_context(tenant.id):
        facility = Facility.objects.get()
        assert facility.name == "Sunrise Clinic, Yaba"
        assert sorted(Department.objects.values_list("name", flat=True)) == [
            "Outpatient (OPD)",
            "Pharmacy",
        ]
    assert AuditEntry.objects.filter(resource="onboarding.profile", action="update").exists()


def test_sec_02_only_the_tenant_admin_can_use_the_questions(
    django_capture_on_commit_callbacks, make_user, signed_in
):
    verified_client(django_capture_on_commit_callbacks)
    tenant = Tenant.objects.get()
    doctor = signed_in(make_user("doc-ob", tenant, [Role.DOCTOR]))
    assert doctor.get(f"{PROFILE}current/").status_code == 403
    assert doctor.post(f"{PROFILE}save/", {"city": "x"}, format="json").status_code == 403
    assert APIClient().get(f"{PROFILE}current/").status_code in (401, 403)


def test_sec_07_another_organisation_never_sees_these_answers(
    django_capture_on_commit_callbacks, make_user, signed_in, tenant_b
):
    verified_client(django_capture_on_commit_callbacks)
    admin_b = signed_in(make_user("admin-b-ob", tenant_b, [Role.TENANT_ADMIN]))
    # Tenant B was set up by hand, so it has no onboarding to complete.
    assert admin_b.get(f"{PROFILE}current/").status_code == 404
