"""Tenant admins manage users and role assignments of their own organisation."""

import pytest
from django.core import mail

from apps.accounts.models import ApiToken, RoleAssignment, User
from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.tenants.models import Department, Facility

pytestmark = pytest.mark.django_db

USERS = "/api/accounts/users/"
ASSIGNMENTS = "/api/accounts/role-assignments/"


@pytest.fixture
def admin(make_user, tenant_a, signed_in):
    return signed_in(make_user("admin", tenant_a, [Role.TENANT_ADMIN]))


def test_tenant_admin_invites_a_user_into_their_tenant(
    admin, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = admin.post(
            USERS, {"username": "newdoc", "email": "newdoc@example.test"}, format="json"
        )
    assert response.status_code == 201
    user = User.objects.get(username="newdoc")
    assert user.tenant_id == tenant_a.id
    assert not user.has_usable_password()
    assert mail.outbox[0].to == ["newdoc@example.test"]
    assert AuditEntry.objects.filter(action="create", resource="accounts.user").exists()


def test_tenant_admin_lists_only_their_tenants_users(admin, user_a, user_b):
    usernames = [u["username"] for u in admin.get(USERS).json()["results"]]
    assert "alice" in usernames and "bola" not in usernames
    assert admin.get(f"{USERS}{user_b.id}/").status_code == 404


def test_deactivating_a_user_revokes_their_tokens(admin, user_a, token_client):
    client = token_client(user_a)
    response = admin.post(f"{USERS}{user_a.id}/deactivate/")
    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert not ApiToken.objects.usable().filter(user=user_a).exists()
    assert client.get("/api/accounts/auth/me/").status_code == 401


def test_users_cannot_be_deleted(admin, user_a):
    assert admin.delete(f"{USERS}{user_a.id}/").status_code == 405


def test_other_roles_cannot_manage_users(signed_in, user_a, make_user, tenant_a):
    assert signed_in(user_a).get(USERS).status_code == 403
    hr = signed_in(make_user("hr", tenant_a, [Role.HR]))
    assert hr.get(USERS).status_code == 200
    assert hr.post(USERS, {"username": "x"}, format="json").status_code == 403


def test_tenant_admin_assigns_roles_with_attributes(admin, user_a, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        facility = Facility.objects.create(name="Main", code="main")
        dept = Department.objects.create(facility=facility, name="Cardiology")
    response = admin.post(
        ASSIGNMENTS,
        {"user": str(user_a.id), "role": "nurse", "department": str(dept.id)},
        format="json",
    )
    assert response.status_code == 201
    with as_tenant(tenant_a):
        assignment = RoleAssignment.objects.get(user=user_a, role=Role.NURSE)
    assert assignment.facility_id == facility.id  # filled in from the department


def test_roles_cannot_be_assigned_to_another_tenants_user(admin, user_b):
    response = admin.post(ASSIGNMENTS, {"user": str(user_b.id), "role": "doctor"}, format="json")
    assert response.status_code == 400
    assert "user" in response.json()["error"]["details"]
