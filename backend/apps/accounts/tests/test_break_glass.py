"""Break-glass: a clinician opens a record outside their scope with a logged reason,
and the compliance role reviews it."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import BreakGlassGrant
from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.tenants.models import Department, Facility
from tests.tenancy_app.models import Folder, Record

pytestmark = pytest.mark.django_db

REASON = "Patient arrived unconscious in the emergency department"


@pytest.fixture
def setup(tenant_a, as_tenant, make_user):
    with as_tenant(tenant_a):
        facility = Facility.objects.create(name="Main", code="main")
        cardio = Department.objects.create(facility=facility, name="Cardiology")
        paeds = Department.objects.create(facility=facility, name="Paediatrics")
        outside = Record.objects.create(title="outside", facility=facility, department=paeds)
    doctor = make_user("doc", tenant_a, [Role.DOCTOR], department=cardio)
    return {"doctor": doctor, "record": outside}


def open_glass(client, record, reason=REASON, resource="tenancy_app.record"):
    return client.post(
        "/api/accounts/break-glass/",
        {"resource": resource, "object_id": str(record.id), "reason": reason},
        format="json",
    )


def test_break_glass_opens_one_record_and_logs_the_reason(signed_in, setup):
    client = signed_in(setup["doctor"])
    url = f"/test-api/records/{setup['record'].id}/"
    assert client.get(url).status_code == 403

    response = open_glass(client, setup["record"])
    assert response.status_code == 201
    assert client.get(url).status_code == 200

    grant = BreakGlassGrant.all_tenants.get()
    assert grant.reason == REASON and grant.review_status == "pending"
    logged = AuditEntry.objects.get(action="break_glass")
    assert logged.reason == REASON
    assert logged.object_id == str(setup["record"].id)
    read = AuditEntry.objects.get(action="read", object_id=str(setup["record"].id))
    assert read.reason == "break_glass"
    assert read.details["break_glass_grant_id"] == str(grant.id)


def test_break_glass_is_for_viewing_only(signed_in, setup):
    client = signed_in(setup["doctor"])
    open_glass(client, setup["record"])
    response = client.patch(
        f"/test-api/records/{setup['record'].id}/", {"title": "edited"}, format="json"
    )
    assert response.status_code == 403


def test_break_glass_expires(signed_in, setup):
    client = signed_in(setup["doctor"])
    open_glass(client, setup["record"])
    BreakGlassGrant.all_tenants.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert client.get(f"/test-api/records/{setup['record'].id}/").status_code == 403


def test_break_glass_needs_a_real_reason(signed_in, setup):
    response = open_glass(signed_in(setup["doctor"]), setup["record"], reason="because")
    assert response.status_code == 400
    assert "reason" in response.json()["error"]["details"]


def test_break_glass_is_refused_for_non_clinical_roles(signed_in, make_user, tenant_a, setup):
    clerk = make_user("clerk", tenant_a, [Role.FRONT_DESK])
    response = open_glass(signed_in(clerk), setup["record"])
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "break_glass_refused"


def test_break_glass_is_refused_for_resources_without_it(signed_in, setup, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        folder = Folder.objects.create(name="Forms")
    response = open_glass(signed_in(setup["doctor"]), folder, resource="tenancy_app.folder")
    assert response.status_code == 403


def test_break_glass_cannot_reach_another_tenant(signed_in, setup, tenant_b, as_tenant):
    with as_tenant(tenant_b):
        foreign = Record.objects.create(title="foreign")
    response = open_glass(signed_in(setup["doctor"]), foreign)
    assert response.status_code == 400
    assert not BreakGlassGrant.all_tenants.exists()


# -- compliance review -------------------------------------------------------------


@pytest.fixture
def compliance(make_user, tenant_a, signed_in):
    return signed_in(make_user("auditor", tenant_a, [Role.COMPLIANCE_OFFICER]))


def test_compliance_reviews_break_glass_access(signed_in, setup, compliance):
    open_glass(signed_in(setup["doctor"]), setup["record"])
    queue = compliance.get("/api/accounts/break-glass/grants/?review_status=pending").json()
    assert len(queue["results"]) == 1
    grant_id = queue["results"][0]["id"]

    url = f"/api/accounts/break-glass/grants/{grant_id}/review/"
    response = compliance.post(url, {"outcome": "appropriate", "note": "Emergency"}, format="json")
    assert response.status_code == 200
    assert response.json()["review_status"] == "appropriate"
    assert AuditEntry.objects.filter(action="break_glass_review").exists()
    again = compliance.post(url, {"outcome": "inappropriate"}, format="json")
    assert again.status_code == 400


def test_clinicians_cannot_review_break_glass(signed_in, setup):
    client = signed_in(setup["doctor"])
    open_glass(client, setup["record"])
    assert client.get("/api/accounts/break-glass/grants/").status_code == 403


def test_nobody_reviews_their_own_break_glass(signed_in, make_user, tenant_a, setup):
    both = make_user("both", tenant_a, [Role.DOCTOR, Role.COMPLIANCE_OFFICER])
    client = signed_in(both)
    # Tenant-wide doctor: needs no break-glass, so create a grant directly for the test.
    grant = BreakGlassGrant.all_tenants.create(
        tenant=tenant_a,
        user=both,
        resource="tenancy_app.record",
        object_id=str(setup["record"].id),
        reason=REASON,
        expires_at=timezone.now() + timedelta(hours=1),
    )
    response = client.post(
        f"/api/accounts/break-glass/grants/{grant.id}/review/",
        {"outcome": "appropriate"},
        format="json",
    )
    assert response.status_code == 403
