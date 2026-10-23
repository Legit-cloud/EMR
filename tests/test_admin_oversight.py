"""Tenant admin oversight (SEC-02, widened 2026-10-21): a tenant admin can view everything in
the tenant, clinical content included, but only the care team can change clinical content.
Changing any list below is a product decision, not a refactor."""

from datetime import date

import pytest

from apps.core import policy
from apps.core.policy import Action
from apps.core.roles import Role
from apps.patients.models import Patient

pytestmark = pytest.mark.django_db

# Viewed tenant-wide for oversight.
OVERSIGHT = {
    "accounts.breakglassgrant",
    "audit.auditentry",
    "billing.invoice",
    "billing.journalentry",
    "billing.ledger",
    "billing.payment",
    "billing.paymentintent",
    "patients.duplicatereview",
    "patients.patient",
    "pharmacy.drug",
    "pharmacy.stockbatch",
    "pharmacy.vendor",
    "pharmacy.purchaseorder",
    "scheduling.appointment",
}
# Administration the role already ran before oversight was added.
ADMINISTRATION = {
    "accounts.roleassignment",
    "accounts.user",
    "billing.insurer",
    "inpatient.bed",
    "inpatient.ward",
    "portal.account",
    "portal.request",
    "scheduling.availabilitywindow",
    "staff.shift",
    "staff.staffprofile",
    "tenants.department",
    "tenants.facility",
}
# Clinical content: visible to the admin role, never editable by it.
CLINICAL = {
    "clinical.consultationnote",
    "clinical.diagnosis",
    "clinical.encounter",
    "clinical.vitalsigns",
    "inpatient.admission",
    "patients.allergy",
    "patients.attachment",
    "pharmacy.prescription",
}


def _grants(resource, action):
    return [g for g in resource.grants if Role.TENANT_ADMIN in g.roles and action in g.actions]


def test_sec_02_admin_views_exactly_the_oversight_administration_and_clinical_resources():
    # tenancy_app models exist only in the test settings.
    resources = {
        n: r for n, r in policy.registered_resources().items() if not n.startswith("tenancy_app.")
    }
    viewable = {name for name, r in resources.items() if _grants(r, Action.VIEW)}
    assert viewable == OVERSIGHT | ADMINISTRATION | CLINICAL


def test_sec_02_oversight_and_clinical_are_tenant_wide_and_read_only():
    for name in OVERSIGHT | CLINICAL:
        resource = policy.get_resource(name)
        assert all(g.scope == policy.Scope.TENANT for g in _grants(resource, Action.VIEW)), name
        for action in (Action.CREATE, Action.UPDATE, Action.DELETE, Action.DISPENSE):
            assert not _grants(resource, action), (name, action)


@pytest.fixture
def admin(make_user, tenant_a, signed_in):
    return signed_in(make_user("oversight-admin", tenant_a, [Role.TENANT_ADMIN]))


@pytest.fixture
def patient(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        return Patient.objects.create(
            first_name="Amaka", last_name="Obi", date_of_birth=date(1980, 2, 2), sex="female"
        )


def test_sec_02_admin_reads_operational_lists(admin, patient):
    for url in (
        "/api/patients/patients/",
        "/api/scheduling/appointments/",
        "/api/billing/invoices/",
        "/api/audit/entries/",
        "/api/accounts/break-glass/grants/",
    ):
        assert admin.get(url).status_code == 200, url
    ids = {p["id"] for p in admin.get("/api/patients/patients/").json()["results"]}
    assert str(patient.id) in ids


def test_sec_02_admin_reads_clinical_records_but_cannot_break_glass(admin, patient):
    response = admin.get(f"/api/clinical/encounters/?patient={patient.id}")
    assert response.status_code == 200
    status = admin.get(f"/api/accounts/break-glass/patients/{patient.id}/").json()
    assert status["can_break_glass"] is False and status["hidden_records"] is False


def test_sec_03_admin_reads_are_audited(admin, patient):
    from apps.audit.models import AuditEntry

    admin.get(f"/api/patients/patients/{patient.id}/")
    entry = AuditEntry.objects.get(action="read", object_id=str(patient.id))
    assert entry.resource == "patients.patient"
