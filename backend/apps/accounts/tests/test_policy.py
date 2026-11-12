"""SEC-02: server-side RBAC + ABAC on every request.

Uses the test-only Record resource, registered in tests/tenancy_app/apps.py with:
doctor view/create/update by department, nurse view by care team while on duty,
lab technician view by facility, break-glass enabled. No other role has a grant.
"""

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.core import policy
from apps.core.policy import Action, Scope
from apps.core.roles import Role
from apps.tenants.models import Department, Facility
from tests.tenancy_app.models import Folder, Record

pytestmark = pytest.mark.django_db

RECORDS = "/test-api/records/"


@pytest.fixture
def org(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        f1 = Facility.objects.create(name="Main hospital", code="main")
        f2 = Facility.objects.create(name="Annex", code="annex")
        d1 = Department.objects.create(facility=f1, name="Cardiology")
        d2 = Department.objects.create(facility=f1, name="Paediatrics")
        d3 = Department.objects.create(facility=f2, name="Outpatients")
        r1 = Record.objects.create(title="r1", facility=f1, department=d1)
        r2 = Record.objects.create(title="r2", facility=f1, department=d2)
        r3 = Record.objects.create(title="r3", facility=f2, department=d3)
    return {"f1": f1, "f2": f2, "d1": d1, "d2": d2, "d3": d3, "r1": r1, "r2": r2, "r3": r3}


@pytest.fixture
def on_duty():
    """Switch the shift provider on for everyone during a test."""
    previous = policy.get_on_duty_provider()
    policy.set_on_duty_provider(lambda user_id: True)
    yield
    policy.set_on_duty_provider(previous)


def titles(response):
    assert response.status_code == 200, response.json()
    return sorted(r["title"] for r in response.json()["results"])


# -- role and scope matrix ---------------------------------------------------------


def test_sec_02_doctor_in_a_department_sees_only_that_department(
    signed_in, make_user, tenant_a, org
):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR], department=org["d1"])
    client = signed_in(doctor)
    assert titles(client.get(RECORDS)) == ["r1"]
    assert client.get(f"{RECORDS}{org['r1'].id}/").status_code == 200
    response = client.get(f"{RECORDS}{org['r2'].id}/")
    assert response.status_code == 403
    # Still refused, but a clinician is told the record can be opened with break-glass.
    assert response.json()["error"]["code"] == "break_glass_available"


def test_sec_02_doctor_assigned_to_a_facility_sees_its_departments(
    signed_in, make_user, tenant_a, org
):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR], facility=org["f1"])
    assert titles(signed_in(doctor).get(RECORDS)) == ["r1", "r2"]


def test_sec_02_tenant_wide_doctor_sees_everything(signed_in, make_user, tenant_a, org):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR])
    assert titles(signed_in(doctor).get(RECORDS)) == ["r1", "r2", "r3"]


def test_sec_02_lab_technician_is_limited_to_their_facility(signed_in, make_user, tenant_a, org):
    tech = make_user("lab", tenant_a, [Role.LAB_TECHNICIAN], facility=org["f2"])
    client = signed_in(tech)
    assert titles(client.get(RECORDS)) == ["r3"]
    assert client.post(RECORDS, {"title": "x"}, format="json").status_code == 403


def test_sec_02_nurse_needs_care_team_membership_and_to_be_on_duty(
    signed_in, make_user, tenant_a, org, as_tenant
):
    nurse = make_user("nurse", tenant_a, [Role.NURSE])
    with as_tenant(tenant_a):
        org["r1"].care_team.add(nurse)
    client = signed_in(nurse)
    assert client.get(RECORDS).status_code == 403  # off duty: no grant applies

    previous = policy.get_on_duty_provider()
    policy.set_on_duty_provider(lambda user_id: user_id == nurse.pk)
    try:
        assert titles(client.get(RECORDS)) == ["r1"]
        assert client.get(f"{RECORDS}{org['r2'].id}/").status_code == 403
    finally:
        policy.set_on_duty_provider(previous)


@pytest.mark.parametrize(
    "role",
    [
        Role.TENANT_ADMIN,
        Role.PHARMACIST,
        Role.FRONT_DESK,
        Role.BILLING_OFFICER,
        Role.FINANCE,
        Role.HR,
        Role.COMPLIANCE_OFFICER,
        Role.PATIENT,
    ],
)
def test_sec_02_roles_without_a_grant_are_refused(role, signed_in, make_user, tenant_a, org):
    client = signed_in(make_user("someone", tenant_a, [role]))
    assert client.get(RECORDS).status_code == 403
    assert client.get(f"{RECORDS}{org['r1'].id}/").status_code == 403
    assert client.post(RECORDS, {"title": "x"}, format="json").status_code == 403


def test_sec_02_user_with_no_roles_is_refused(signed_in, make_user, tenant_a, org):
    assert signed_in(make_user("nobody", tenant_a)).get(RECORDS).status_code == 403


def test_sec_02_action_not_granted_is_refused_even_in_scope(signed_in, make_user, tenant_a, org):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR])
    response = signed_in(doctor).delete(f"{RECORDS}{org['r1'].id}/")
    assert response.status_code == 403  # doctors have no delete grant on records


# -- writes must stay in scope -----------------------------------------------------


def test_sec_02_create_inside_scope_is_allowed(signed_in, make_user, tenant_a, org):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR], department=org["d1"])
    payload = {"title": "new", "facility": str(org["f1"].id), "department": str(org["d1"].id)}
    assert signed_in(doctor).post(RECORDS, payload, format="json").status_code == 201


def test_sec_02_create_outside_scope_is_refused_and_rolled_back(
    signed_in, make_user, tenant_a, org
):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR], department=org["d1"])
    payload = {"title": "sneaky", "facility": str(org["f1"].id), "department": str(org["d2"].id)}
    response = signed_in(doctor).post(RECORDS, payload, format="json")
    assert response.status_code == 403
    assert not Record.all_tenants.filter(title="sneaky").exists()


def test_sec_02_update_cannot_move_a_record_out_of_scope(signed_in, make_user, tenant_a, org):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR], department=org["d1"])
    response = signed_in(doctor).patch(
        f"{RECORDS}{org['r1'].id}/", {"department": str(org["d2"].id)}, format="json"
    )
    assert response.status_code == 403
    assert Record.all_tenants.get(pk=org["r1"].id).department_id == org["d1"].id


def test_sec_02_non_phi_resource_with_tenant_scope(signed_in, make_user, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        Folder.objects.create(name="Forms")
    front_desk = signed_in(make_user("desk", tenant_a, [Role.FRONT_DESK]))
    assert titles_of_folders(front_desk.get("/test-api/folders/")) == ["Forms"]
    assert front_desk.post("/test-api/folders/", {"name": "x"}, format="json").status_code == 403


def titles_of_folders(response):
    return [r["name"] for r in response.json()["results"]]


# -- MFA ---------------------------------------------------------------------------


def test_sec_02_roles_that_require_mfa_are_refused_without_it(signed_in, make_user, tenant_a, org):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR])
    response = signed_in(doctor, mfa=False).get(RECORDS)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "mfa_required"


def test_sec_02_unverified_token_is_refused_for_mfa_roles(token_client, make_user, tenant_a, org):
    doctor = make_user("doc", tenant_a, [Role.DOCTOR])
    response = token_client(doctor, mfa=False).get(RECORDS)
    assert response.json()["error"]["code"] == "mfa_required"
    assert titles(token_client(doctor).get(RECORDS)) == ["r1", "r2", "r3"]


def test_sec_02_mfa_role_list_is_configurable(signed_in, make_user, tenant_a, org, settings):
    settings.MFA_REQUIRED_ROLES = []
    doctor = make_user("doc", tenant_a, [Role.DOCTOR])
    assert signed_in(doctor, mfa=False).get(RECORDS).status_code == 200


# -- registration rules ------------------------------------------------------------


def test_policy_refuses_scopes_the_model_cannot_support():
    with pytest.raises(ImproperlyConfigured):
        policy.register(
            "test.bad_facility",
            model=Folder,
            grants=[policy.grant({Role.DOCTOR}, {Action.VIEW}, Scope.FACILITY)],
        )
    with pytest.raises(ImproperlyConfigured):
        policy.register(
            "test.bad_care_team",
            model=Folder,
            grants=[policy.grant({Role.DOCTOR}, {Action.VIEW}, Scope.CARE_TEAM)],
        )


def test_unregistered_resource_is_a_configuration_error():
    with pytest.raises(ImproperlyConfigured):
        policy.get_resource("nowhere.nothing")
