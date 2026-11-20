"""Sign in with an email address; invitations carry a role; links use the web app's address.
Requirement IDs: SEC-02, SEC-03, SEC-06, DG-01 (no account enumeration)."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.core import mail

from apps.accounts.models import RoleAssignment, User
from apps.accounts.role_info import RESOURCE_LABELS, ROLE_INFO, catalogue, label_for
from apps.audit.models import AuditEntry
from apps.core import policy
from apps.core.roles import Role
from apps.core.tenancy import tenant_context

pytestmark = pytest.mark.django_db

LOGIN = "/api/accounts/auth/login/"
USERS = "/api/accounts/users/"
PASSWORD = "not-a-real-password-123"


def login(client, who, password=PASSWORD):
    return client.post(
        LOGIN, {"username": who, "password": password, "mode": "token"}, format="json"
    )


def code(response):
    return response.json()["error"]["code"]


# -- signing in with an email address --------------------------------------------------------


def test_an_email_address_and_password_start_the_sign_in(api_client, make_user, tenant_a):
    make_user("ada.o", tenant_a, [Role.DOCTOR], email="Ada@Hospital.example.test")
    for typed in ("ada@hospital.example.test", "ADA@HOSPITAL.EXAMPLE.TEST", " ada.o "):
        assert code(login(api_client, typed)) == "mfa_required", typed


def test_a_wrong_password_or_unknown_email_is_refused_the_same_way(api_client, make_user, tenant_a):
    make_user("ada.o", tenant_a, [Role.DOCTOR], email="ada@hospital.example.test")
    assert code(login(api_client, "ada@hospital.example.test", "wrong")) == "invalid_credentials"
    assert code(login(api_client, "nobody@hospital.example.test")) == "invalid_credentials"


def test_an_email_shared_by_two_accounts_signs_neither_in(
    api_client, make_user, tenant_a, tenant_b
):
    make_user("one", tenant_a, [Role.DOCTOR], email="shared@example.test")
    make_user("two", tenant_b, [Role.DOCTOR], email="shared@example.test")
    assert code(login(api_client, "shared@example.test")) == "invalid_credentials"
    assert code(login(api_client, "one")) == "mfa_required"


def test_a_deactivated_account_cannot_sign_in_by_email(api_client, make_user, tenant_a):
    user = make_user("gone", tenant_a, [Role.DOCTOR], email="gone@example.test")
    user.is_active = False
    user.save()
    assert code(login(api_client, "gone@example.test")) == "invalid_credentials"
    assert code(login(api_client, "gone")) == "invalid_credentials"


# -- invitations -------------------------------------------------------------------------------


@pytest.fixture
def admin(make_user, tenant_a, signed_in):
    return signed_in(make_user("admin", tenant_a, [Role.TENANT_ADMIN]))


def test_an_invitation_needs_no_username_and_uses_the_email(
    admin, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = admin.post(
            USERS,
            {"email": "New.Nurse@Example.test", "first_name": "Ngozi", "role": "nurse"},
            format="json",
        )
    assert response.status_code == 201, response.json()
    user = User.objects.get(email="new.nurse@example.test")
    assert user.username == "new.nurse@example.test"
    with tenant_context(tenant_a.id):
        assert list(RoleAssignment.objects.filter(user=user).values_list("role", flat=True)) == [
            "nurse"
        ]
    assert "role" not in response.json() or response.json().get("role") is None
    entry = AuditEntry.objects.filter(action="create", resource="accounts.user").latest(
        "occurred_at"
    )
    assert "role" in entry.details["fields"]


def test_the_invited_person_can_then_sign_in_with_the_email(
    admin, api_client, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        admin.post(USERS, {"email": "dr.new@example.test", "role": "doctor"}, format="json")
    user = User.objects.get(email="dr.new@example.test")
    user.set_password(PASSWORD)
    user.save()
    assert code(login(api_client, "dr.new@example.test")) == "mfa_required"


def test_an_invitation_cannot_give_the_patient_role_or_an_unknown_one(admin):
    assert (
        admin.post(USERS, {"email": "p@example.test", "role": "patient"}, format="json").status_code
        == 400
    )
    assert (
        admin.post(USERS, {"email": "q@example.test", "role": "wizard"}, format="json").status_code
        == 400
    )
    assert not User.objects.filter(email__in=["p@example.test", "q@example.test"]).exists()


def test_an_email_already_in_use_cannot_be_invited_again(admin, make_user, tenant_a):
    make_user("taken", tenant_a, [Role.DOCTOR], email="taken@example.test")
    response = admin.post(USERS, {"email": "TAKEN@example.test", "role": "nurse"}, format="json")
    assert response.status_code == 400 and "email" in response.json()["error"]["details"]


def test_the_invitation_link_uses_the_web_apps_address_never_localhost(
    admin, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        admin.post(USERS, {"email": "link@example.test", "role": "nurse"}, format="json")
    body = mail.outbox[0].body
    assert "https://app.example.test/reset-password?uid=" in body
    assert "localhost" not in body and "127.0.0.1" not in body


# -- the role catalogue ------------------------------------------------------------------------


def test_only_users_who_can_view_users_see_the_role_catalogue(signed_in, user_a, admin):
    assert signed_in(user_a).get(f"{USERS}roles/").status_code == 403
    assert admin.get(f"{USERS}roles/").status_code == 200


def test_the_catalogue_lists_every_role_but_the_patient(admin):
    rows = admin.get(f"{USERS}roles/").json()
    assert [r["role"] for r in rows] == [r.value for r in Role if r != Role.PATIENT]
    assert all(r["label"] and r["description"] and r["permissions"] for r in rows)


def test_permissions_come_from_the_live_policy_rules():
    by_role = {r["role"]: {p["resource"]: p for p in r["permissions"]} for r in catalogue()}
    # A pharmacist dispenses; a doctor prescribes but cannot dispense (separation of duties).
    assert "Dispense" in by_role["pharmacist"]["pharmacy.prescription"]["actions"]
    assert "Dispense" not in by_role["doctor"]["pharmacy.prescription"]["actions"]
    assert "Add" in by_role["doctor"]["pharmacy.prescription"]["actions"]
    # The organisation admin sees clinical records but cannot change them (ADR 0010).
    admin_patients = by_role["tenant_admin"]["patients.patient"]["actions"]
    assert admin_patients == ["View"]
    # Nurses only reach patients on their care team.
    assert by_role["nurse"]["clinical.vitalsigns"]["limit"] != ""


def test_the_catalogue_agrees_with_every_grant_in_the_policy():
    for row in catalogue():
        listed = {p["resource"] for p in row["permissions"]}
        expected = {
            name
            for name, resource in policy.registered_resources().items()
            if not name.startswith("tenancy_app.")
            and any(row["role"] in g.roles for g in resource.grants)
        }
        assert listed == expected, row["role"]


def test_every_policy_resource_and_role_has_plain_words():
    for name in policy.registered_resources():
        if name.startswith("tenancy_app."):
            continue
        assert name in RESOURCE_LABELS, f"add a label for {name} in accounts/role_info.py"
    assert all(role in ROLE_INFO for role in Role if role != Role.PATIENT)
    assert label_for("new.thing_here") == "Thing here"


# -- links in production -----------------------------------------------------------------------


def test_production_refuses_to_start_without_the_web_apps_address():
    root = Path(__file__).resolve().parents[3]
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "SECRET_KEY": "k8Jq2v-production-like-secret-for-the-check-0f9e8d7c6b5a4z3y2x1w",
        "ALLOWED_HOSTS": "emr.example.com",
        "DATABASE_URL": "postgres://user:pass@db:5432/emr",
        "REDIS_URL": "redis://redis:6379/0",
        "PRESCRIPTION_SIGNING_KEY": "cHJvZHVjdGlvbi10ZXN0LWtleS1ub3QtcmVhbC0zMmI=",
    }
    env.pop("FRONTEND_URL", None)
    result = subprocess.run(
        [sys.executable, "manage.py", "check"], cwd=root, env=env, capture_output=True, text=True
    )
    assert result.returncode != 0 and "FRONTEND_URL" in result.stderr
