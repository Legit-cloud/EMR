"""Insurer claims: from an invoice with an insurer to money received.
Requirement IDs: SEC-02, SEC-03, SEC-07, FR-5 (insurer and patient split, claims)."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.billing import claims, services
from apps.billing.models import Claim, Invoice, JournalEntry, Payer, PaymentMethod
from apps.core.roles import Role
from apps.core.tenancy import tenant_context

from .conftest import ngn

pytestmark = pytest.mark.django_db

CLAIMS = "/api/billing/claims/"


@pytest.fixture
def invoice(ctx, patient, insurer):
    """A delivered charge of 10 000.00 with the insurer covering 80%."""
    with ctx():
        line = services.add_line(
            patient_id=patient.pk,
            source="test",
            source_id="1",
            description="Surgery",
            quantity=1,
            unit_price=ngn(1_000_000),
            idempotency_key="claims-1",
        )
        services.set_coverage(line.invoice, insurer=insurer, coverage_bp=8000)
        services.finalise_line("claims-1")
        return Invoice.objects.get(pk=line.invoice_id)


def make(client, invoice):
    return client.post(CLAIMS, {"invoice": str(invoice.pk)}, format="json")


def act(client, claim_id, verb, **body):
    return client.post(f"{CLAIMS}{claim_id}/{verb}/", body, format="json")


def sent(client, invoice):
    claim_id = make(client, invoice).json()["id"]
    assert act(client, claim_id, "submit").status_code == 200
    return claim_id


# -- making and sending ---------------------------------------------------------------------


def test_a_claim_is_for_the_insurer_share_of_the_invoice(billing, invoice):
    body = make(billing, invoice).json()
    assert body["status"] == "draft"
    assert body["claimed_minor"] == 800_000
    assert body["reference"].startswith("CLM-")
    assert body["patient_name"]


def test_an_invoice_without_an_insurer_cannot_be_claimed(billing, ctx, patient):
    with ctx():
        line = services.add_line(
            patient_id=patient.pk,
            source="t",
            source_id="2",
            description="x",
            quantity=1,
            unit_price=ngn(1000),
            idempotency_key="no-insurer",
        )
    response = make(billing, line.invoice)
    assert response.status_code == 409
    assert "no insurer" in response.json()["error"]["message"]


def test_undelivered_charges_block_a_claim(billing, ctx, patient, insurer):
    with ctx():
        line = services.add_line(
            patient_id=patient.pk,
            source="t",
            source_id="3",
            description="x",
            quantity=1,
            unit_price=ngn(500_000),
            idempotency_key="pending-line",
        )
        services.set_coverage(line.invoice, insurer=insurer, coverage_bp=5000)
    response = make(billing, line.invoice)
    assert response.status_code == 409
    assert "not been delivered" in response.json()["error"]["message"]


def test_an_invoice_has_one_live_claim(billing, invoice):
    assert make(billing, invoice).status_code == 201
    assert make(billing, invoice).status_code == 409


def test_a_claim_moves_draft_submitted_approved_paid(billing, finance, invoice, tenant_a):
    claim_id = sent(billing, invoice)
    approved = act(billing, claim_id, "approve", approved_minor=800_000).json()
    assert approved["status"] == "approved" and approved["outstanding_minor"] == 800_000
    first = act(billing, claim_id, "settle", amount_minor=300_000, reference="REM-1").json()
    assert (first["status"], first["received_minor"], first["outstanding_minor"]) == (
        "approved",
        300_000,
        500_000,
    )
    last = act(billing, claim_id, "settle", amount_minor=500_000, reference="REM-2").json()
    assert last["status"] == "paid" and last["settled_at"]
    with tenant_context(tenant_a.id):
        assert Invoice.objects.get(pk=invoice.pk).insurer_paid_minor == 800_000


def test_money_received_posts_to_the_ledger_once(billing, invoice, tenant_a):
    claim_id = sent(billing, invoice)
    act(billing, claim_id, "approve", approved_minor=800_000)
    act(billing, claim_id, "settle", amount_minor=800_000, reference="REM-9")
    with tenant_context(tenant_a.id):
        before = JournalEntry.objects.count()
        payments = list(invoice.payments.all())
    assert [(p.payer, p.method, p.amount_minor) for p in payments] == [
        (Payer.INSURER, PaymentMethod.INSURER_REMITTANCE, 800_000)
    ]
    # The same remittance entered twice changes nothing.
    again = act(billing, claim_id, "settle", amount_minor=800_000, reference="REM-9")
    assert again.status_code == 409  # the claim is paid, so it takes no more money
    with tenant_context(tenant_a.id):
        assert JournalEntry.objects.count() == before


def test_a_remittance_reference_is_required_and_the_amount_is_capped(billing, invoice):
    claim_id = sent(billing, invoice)
    act(billing, claim_id, "approve", approved_minor=500_000, note="Part covered by plan")
    assert act(billing, claim_id, "settle", amount_minor=1, reference=" ").status_code == 400
    over = act(billing, claim_id, "settle", amount_minor=500_001, reference="R")
    assert over.status_code == 409


def test_settling_the_same_reference_twice_is_recorded_once(billing, invoice, tenant_a):
    claim_id = sent(billing, invoice)
    act(billing, claim_id, "approve", approved_minor=800_000)
    act(billing, claim_id, "settle", amount_minor=100_000, reference="REM-5")
    act(billing, claim_id, "settle", amount_minor=100_000, reference="REM-5")
    with tenant_context(tenant_a.id):
        assert Claim.objects.get(pk=claim_id).received_minor == 100_000


# -- the insurer's answer -------------------------------------------------------------------


def test_approving_less_needs_a_reason_and_cannot_exceed_the_claim(billing, invoice):
    claim_id = sent(billing, invoice)
    assert act(billing, claim_id, "approve", approved_minor=900_000).status_code == 409
    assert act(billing, claim_id, "approve", approved_minor=700_000).status_code == 409
    ok = act(billing, claim_id, "approve", approved_minor=700_000, note="Cap on this procedure")
    assert ok.status_code == 200 and ok.json()["approved_minor"] == 700_000


def test_a_rejected_claim_needs_a_reason_and_can_be_sent_again(billing, invoice):
    claim_id = sent(billing, invoice)
    assert act(billing, claim_id, "reject", reason="no").status_code == 409
    rejected = act(billing, claim_id, "reject", reason="Pre-authorisation was missing").json()
    assert rejected["status"] == "rejected"
    assert act(billing, claim_id, "approve", approved_minor=1).status_code == 409
    again = act(billing, claim_id, "submit", insurer_reference="HMO-77").json()
    assert (again["status"], again["attempt"], again["insurer_reference"]) == (
        "submitted",
        2,
        "HMO-77",
    )


def test_only_a_submitted_claim_can_be_answered(billing, invoice):
    claim_id = make(billing, invoice).json()["id"]
    assert act(billing, claim_id, "approve", approved_minor=1000).status_code == 409
    assert act(billing, claim_id, "reject", reason="not sent yet really").status_code == 409
    assert act(billing, claim_id, "settle", amount_minor=1, reference="R").status_code == 409


# -- ageing ---------------------------------------------------------------------------------


def test_ageing_groups_what_insurers_owe_by_days_since_sending(billing, invoice, tenant_a):
    claim_id = sent(billing, invoice)
    with tenant_context(tenant_a.id):
        Claim.objects.filter(pk=claim_id).update(submitted_at=timezone.now() - timedelta(days=45))
    bands = {b["band"]: b for b in billing.get(f"{CLAIMS}ageing/").json()}
    assert bands["31-60"] == {"band": "31-60", "claims": 1, "outstanding_minor": 800_000}
    assert bands["0-30"]["claims"] == 0 and bands["over 90"]["claims"] == 0


# -- who may do what ------------------------------------------------------------------------


def test_sec_02_billing_works_claims_finance_and_admin_look(
    billing, finance, invoice, make_user, signed_in, tenant_a
):
    admin = signed_in(make_user("admin-claims", tenant_a, [Role.TENANT_ADMIN]))
    nurse = signed_in(make_user("nurse-claims", tenant_a, [Role.NURSE]))
    claim_id = make(billing, invoice).json()["id"]
    for viewer in (billing, finance, admin):
        assert viewer.get(CLAIMS).status_code == 200
    for outsider in (finance, admin, nurse):
        assert make(outsider, invoice).status_code == 403
        assert act(outsider, claim_id, "submit").status_code == 403
    assert nurse.get(CLAIMS).status_code == 403


def test_sec_03_claim_changes_are_audited(billing, invoice):
    sent(billing, invoice)
    assert AuditEntry.objects.filter(resource="billing.claim", action="update").exists()


def test_sec_07_another_organisation_cannot_see_or_change_a_claim(
    billing, invoice, make_user, signed_in, tenant_b
):
    claim_id = make(billing, invoice).json()["id"]
    other = signed_in(make_user("billing-b", tenant_b, [Role.BILLING_OFFICER]))
    assert other.get(CLAIMS).json()["results"] == []
    assert other.get(f"{CLAIMS}{claim_id}/").status_code == 404
    assert act(other, claim_id, "submit").status_code == 404


def test_the_service_refuses_a_claim_for_an_invoice_the_insurer_has_fully_paid(ctx, invoice):
    with ctx():
        made = claims.create_claim(invoice)
        claims.submit(made)
        claims.approve(made, approved_minor=made.claimed_minor)
        claims.settle(made, amount_minor=made.claimed_minor, reference="ALL")
        with pytest.raises(claims.ClaimRefused):
            claims.create_claim(Invoice.objects.get(pk=invoice.pk))
