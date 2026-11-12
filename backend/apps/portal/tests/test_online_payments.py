"""Paying a bill online with Paystack (ADR 0023). Requirement IDs: SEC-02, SEC-03, SEC-07, and the
rule that money is recorded only after the gateway confirms it."""

import hashlib
import hmac
import json

import pytest
from django.core import mail

from apps.audit.models import AuditEntry
from apps.billing import services as billing
from apps.billing.gateway import FakeGateway
from apps.billing.models import IntentStatus, Invoice, Payment, PaymentIntent
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context

pytestmark = pytest.mark.django_db

PORTAL = "/api/portal/"
WEBHOOK = "/api/billing/webhooks/paystack/"
SECRET = "sk_test_unit_tests_only"


@pytest.fixture(autouse=True)
def _gateway():
    FakeGateway.reset()
    yield
    FakeGateway.reset()


@pytest.fixture
def bill(ada, tenant_a):
    """A ₦10,000 consultation bill for Ada, fully owed."""
    with tenant_context(tenant_a.id):
        line = billing.charge_delivered(
            patient_id=ada.pk,
            source="test",
            source_id="1",
            description="Consultation",
            quantity=1,
            unit_price=Money(1_000_000, "NGN"),
            idempotency_key="online:bill",
            revenue_category="consultation",
        )
        return Invoice.objects.get(pk=line.invoice_id)


def pay(client, bill, amount):
    return client.post(f"{PORTAL}invoices/{bill.pk}/pay/", {"amount_minor": amount}, format="json")


def succeed(intent, amount=None, currency="NGN"):
    """What Paystack reports once the patient has paid."""
    return {
        "status": "success",
        "amount_minor": intent.amount_minor if amount is None else amount,
        "currency": currency,
        "reference": intent.reference,
        "gateway_id": "9876543",
    }


def webhook(client, event, secret=SECRET, signature=None):
    body = json.dumps(event).encode()
    signature = signature or hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    return client.generic(
        "POST", WEBHOOK, body, content_type="application/json", HTTP_X_PAYSTACK_SIGNATURE=signature
    )


def charge_success(intent, amount=None, currency="NGN"):
    return {
        "event": "charge.success",
        "data": {
            "status": "success",
            "reference": intent.reference,
            "amount": intent.amount_minor if amount is None else amount,
            "currency": currency,
            "id": 4242,
        },
    }


# -- starting a payment ----------------------------------------------------------------------


def test_starting_a_payment_returns_the_hosted_page_and_does_not_touch_the_bill(
    as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    response = pay(client, bill, 400_000)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["authorization_url"] == f"https://checkout.paystack.test/{body['reference']}"
    assert body["amount_minor"] == 400_000 and body["currency"] == "NGN"
    (sent,) = FakeGateway.initialized
    assert sent["email"] == ada.email
    assert sent["amount_minor"] == 400_000
    assert sent["callback_url"] == "https://hospital.example.test/portal/invoices"
    with tenant_context(tenant_a.id):
        assert Invoice.objects.get(pk=bill.pk).patient_paid_minor == 0
        assert not Payment.objects.exists()


@pytest.mark.parametrize("amount", [0, -5, 1_000_001])
def test_the_amount_must_be_positive_and_no_more_than_the_patient_owes(
    as_patient, ada, bill, amount
):
    client, _ = as_patient(ada)
    assert pay(client, bill, amount).status_code in (400, 409)
    assert FakeGateway.initialized == []


def test_a_patient_cannot_pay_or_verify_someone_elses_bill(as_patient, ada, bola, bill):
    bola_client, _ = as_patient(bola)
    assert pay(bola_client, bill, 100_000).status_code == 404
    ada_client, _ = as_patient(ada)
    started = pay(ada_client, bill, 100_000).json()
    assert bola_client.post(f"{PORTAL}payments/{started['reference']}/verify/").status_code == 404


def test_only_the_patients_own_share_can_be_paid_online(as_patient, bola, tenant_a):
    from apps.billing.models import Insurer

    client, _ = as_patient(bola)
    with tenant_context(tenant_a.id):
        # Nothing delivered yet, so the insurer split can still be set.
        line = billing.add_line(
            patient_id=bola.pk,
            source="test",
            source_id="2",
            description="Admission pack",
            quantity=1,
            unit_price=Money(1_000_000, "NGN"),
            idempotency_key="online:insured",
        )
        insured = Invoice.objects.get(pk=line.invoice_id)
        insurer = Insurer.objects.create(name="Pay HMO", code="pay-hmo")
        billing.set_coverage(insured, insurer=insurer, coverage_bp=8_000)
    assert pay(client, insured, 200_001).status_code == 409  # the patient owes ₦2,000.00
    assert pay(client, insured, 200_000).status_code == 201


def test_no_payment_for_a_bill_held_for_estate_review_or_already_paid(
    as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    with tenant_context(tenant_a.id):
        Invoice.objects.filter(pk=bill.pk).update(estate_review=True)
    assert pay(client, bill, 100_000).status_code == 409
    with tenant_context(tenant_a.id):
        Invoice.objects.filter(pk=bill.pk).update(estate_review=False)
        billing.record_payment(
            Invoice.objects.get(pk=bill.pk),
            payer="patient",
            method="cash",
            amount=Money(1_000_000, "NGN"),
        )
    assert pay(client, bill, 100_000).status_code == 409


def test_when_the_gateway_is_down_the_patient_is_told_and_no_bill_changes(
    as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    FakeGateway.fail = True
    response = pay(client, bill, 100_000)
    assert response.status_code == 502
    with tenant_context(tenant_a.id):
        (intent,) = PaymentIntent.objects.all()
        assert intent.status == IntentStatus.FAILED
        assert not Payment.objects.exists()


def test_without_a_secret_key_online_payment_is_unavailable(as_patient, ada, bill, settings):
    from apps.billing.gateway import PaystackGateway

    settings.PAYMENT_GATEWAY = "apps.billing.gateway.PaystackGateway"
    settings.PAYSTACK_SECRET_KEY = ""
    client, _ = as_patient(ada)
    assert PaystackGateway  # the real adapter, which refuses without a key
    response = pay(client, bill, 100_000)
    assert response.status_code == 503


def test_closing_the_tab_and_trying_again_returns_to_the_same_payment_page(as_patient, ada, bill):
    client, _ = as_patient(ada)
    first = pay(client, bill, 300_000).json()
    again = pay(client, bill, 300_000).json()
    assert again["reference"] == first["reference"]
    assert len(FakeGateway.initialized) == 1
    # A different amount while one is open must wait, so two payments cannot overpay the bill.
    assert pay(client, bill, 100_000).status_code == 409


# -- confirming: the browser's word counts for nothing ---------------------------------------


def test_coming_back_from_the_payment_page_records_nothing_until_paystack_confirms(
    as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    result = client.post(f"{PORTAL}payments/{started['reference']}/verify/")
    assert result.status_code == 200
    assert result.json()["status"] == "pending"  # Paystack reports it abandoned
    with tenant_context(tenant_a.id):
        assert not Payment.objects.exists()


def test_a_confirmed_payment_is_recorded_once_with_the_right_amount_and_ledger(
    as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
    FakeGateway.results[started["reference"]] = succeed(intent)
    first = client.post(f"{PORTAL}payments/{started['reference']}/verify/")
    second = client.post(f"{PORTAL}payments/{started['reference']}/verify/")
    assert first.json()["status"] == second.json()["status"] == "succeeded"
    with tenant_context(tenant_a.id):
        (payment,) = Payment.objects.all()
        assert (payment.amount_minor, payment.method, payment.payer) == (
            400_000,
            "online",
            "patient",
        )
        assert payment.reference == started["reference"]
        invoice = Invoice.objects.get(pk=bill.pk)
        assert (invoice.patient_paid_minor, invoice.payment_status) == (400_000, "partially_paid")
        assert PaymentIntent.objects.get(pk=intent.pk).status == IntentStatus.SUCCEEDED
        assert billing.reconcile() == []
    (shown,) = client.get(f"{PORTAL}invoices/").json()
    assert (shown["paid_minor"], shown["due_minor"]) == (400_000, 600_000)


def test_paying_the_rest_marks_the_bill_paid(as_patient, ada, bill, tenant_a):
    client, _ = as_patient(ada)
    for amount in (400_000, 600_000):
        started = pay(client, bill, amount).json()
        with tenant_context(tenant_a.id):
            intent = PaymentIntent.objects.get(reference=started["reference"])
        FakeGateway.results[started["reference"]] = succeed(intent)
        assert (
            client.post(f"{PORTAL}payments/{started['reference']}/verify/").json()["status"]
            == "succeeded"
        )
    with tenant_context(tenant_a.id):
        assert Invoice.objects.get(pk=bill.pk).payment_status == "paid"


def test_a_payment_for_the_wrong_amount_is_parked_for_finance_not_recorded(
    as_patient, ada, bill, tenant_a, make_user, django_capture_on_commit_callbacks
):
    make_user("billing-alert", tenant_a, [Role.BILLING_OFFICER])
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
    FakeGateway.results[started["reference"]] = succeed(intent, amount=300_000)
    with django_capture_on_commit_callbacks(execute=True):
        result = client.post(f"{PORTAL}payments/{started['reference']}/verify/")
    assert result.json()["status"] == "review"
    with tenant_context(tenant_a.id):
        assert not Payment.objects.exists()
        assert PaymentIntent.objects.get(pk=intent.pk).status == IntentStatus.FLAGGED
    assert any("needs review" in m.subject for m in mail.outbox)


def test_money_taken_after_the_bill_was_settled_another_way_is_flagged_not_lost(
    as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
        billing.record_payment(
            Invoice.objects.get(pk=bill.pk),
            payer="patient",
            method="cash",
            amount=Money(1_000_000, "NGN"),
        )
    FakeGateway.results[started["reference"]] = succeed(intent)
    assert (
        client.post(f"{PORTAL}payments/{started['reference']}/verify/").json()["status"] == "review"
    )
    with tenant_context(tenant_a.id):
        assert Payment.objects.count() == 1  # only the cash
        flagged = PaymentIntent.objects.get(pk=intent.pk)
        assert flagged.status == IntentStatus.FLAGGED
        assert "could not take it" in flagged.note


# -- the webhook -----------------------------------------------------------------------------


def test_sec_06_a_webhook_without_a_valid_signature_is_refused_and_logged(
    api_client, as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
    event = charge_success(intent)
    for bad in (
        webhook(api_client, event, signature="0" * 128),
        webhook(api_client, event, secret="sk_test_someone_else"),
        api_client.post(WEBHOOK, event, format="json"),
    ):
        assert bad.status_code == 401
    with tenant_context(tenant_a.id):
        assert not Payment.objects.exists()
    assert AuditEntry.objects.filter(resource="billing.webhook", outcome="denied").count() == 3


def test_a_signed_webhook_records_the_payment_once_even_if_delivered_twice(
    api_client, as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
    event = charge_success(intent)
    assert webhook(api_client, event).status_code == 200
    assert webhook(api_client, event).status_code == 200
    with tenant_context(tenant_a.id):
        (payment,) = Payment.objects.all()
        assert payment.amount_minor == 400_000
        assert PaymentIntent.objects.get(pk=intent.pk).gateway_transaction_id == "4242"
    # And a later "verify" from the browser changes nothing.
    FakeGateway.results[started["reference"]] = succeed(intent)
    assert (
        client.post(f"{PORTAL}payments/{started['reference']}/verify/").json()["status"]
        == "succeeded"
    )
    with tenant_context(tenant_a.id):
        assert Payment.objects.count() == 1


def test_a_signed_webhook_cannot_change_the_amount_or_name_a_reference_we_never_issued(
    api_client, as_patient, ada, bill, tenant_a
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
    assert webhook(api_client, charge_success(intent, amount=100)).status_code == 200
    unknown = {
        "event": "charge.success",
        "data": {"reference": "emr_nope", "amount": 5, "currency": "NGN", "status": "success"},
    }
    assert webhook(api_client, unknown).status_code == 200
    with tenant_context(tenant_a.id):
        assert not Payment.objects.exists()
        assert PaymentIntent.objects.get(pk=intent.pk).status == IntentStatus.FLAGGED


def test_other_webhook_events_are_acknowledged_and_ignored(api_client):
    assert webhook(api_client, {"event": "transfer.success", "data": {}}).status_code == 200
    body = b"not json"
    signature = hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()
    response = api_client.generic(
        "POST", WEBHOOK, body, content_type="application/json", HTTP_X_PAYSTACK_SIGNATURE=signature
    )
    assert response.status_code == 200


# -- staff cannot fake an online payment, and finance can see what is flagged -----------------


def test_a_clerk_cannot_record_a_manual_payment_as_online(make_user, signed_in, tenant_a, bill):
    officer = signed_in(make_user("officer-online", tenant_a, [Role.BILLING_OFFICER]))
    response = officer.post(
        f"/api/billing/invoices/{bill.pk}/pay/",
        {"payer": "patient", "method": "online", "amount_minor": 100_000},
        format="json",
    )
    assert response.status_code == 400
    with tenant_context(tenant_a.id):
        assert not Payment.objects.exists()


def test_finance_and_the_admin_can_list_online_payments_but_other_roles_cannot(
    as_patient, ada, bill, make_user, signed_in, tenant_a
):
    client, _ = as_patient(ada)
    pay(client, bill, 100_000)
    url = "/api/billing/payment-intents/"
    for role in (Role.FINANCE, Role.BILLING_OFFICER, Role.TENANT_ADMIN):
        assert signed_in(make_user(f"i-{role}", tenant_a, [role])).get(url).json()["count"] == 1
    for role in (Role.DOCTOR, Role.FRONT_DESK, Role.NURSE):
        assert signed_in(make_user(f"i-{role}", tenant_a, [role])).get(url).status_code == 403


def test_sec_07_a_webhook_credits_the_tenant_that_issued_the_reference(
    api_client, as_patient, ada, bill, tenant_a, tenant_b
):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    with tenant_context(tenant_a.id):
        intent = PaymentIntent.objects.get(reference=started["reference"])
    webhook(api_client, charge_success(intent))
    with tenant_context(tenant_b.id):
        assert not Payment.objects.exists()
    with tenant_context(tenant_a.id):
        assert Payment.objects.count() == 1


def test_sec_03_starting_and_confirming_a_payment_are_audited(as_patient, ada, bill, tenant_a):
    client, _ = as_patient(ada)
    started = pay(client, bill, 400_000).json()
    client.post(f"{PORTAL}payments/{started['reference']}/verify/")
    with tenant_context(tenant_a.id):
        entries = AuditEntry.objects.filter(resource="portal.payment", tenant_id=tenant_a.id)
        assert {e.action for e in entries} == {"create", "update"}
        assert all(e.details["payment_reference"] == started["reference"] for e in entries)
