"""Invoices, insurer and patient split, payments, the double-entry ledger and reconciliation."""

import pytest
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction

from apps.billing import ledger, services
from apps.billing.models import (
    Invoice,
    InvoiceLine,
    JournalEntry,
    JournalLine,
    Payment,
)
from apps.core.errors import DomainError
from apps.core.roles import Role

from .conftest import ngn

pytestmark = pytest.mark.django_db


def charge(patient, key, amount=10_000, quantity=1, category="pharmacy", delivered=False):
    add = services.charge_delivered if delivered else services.add_line
    return add(
        patient_id=patient.pk,
        source="test.source",
        source_id=key,
        description=f"Charge {key}",
        quantity=quantity,
        unit_price=ngn(amount),
        idempotency_key=f"test:{key}",
        revenue_category=category,
    )


def invoice_of(line) -> Invoice:
    return Invoice.all_tenants.get(pk=line.invoice_id)


# -- charges and totals ----------------------------------------------------------------


def test_lines_total_into_the_patients_open_invoice(ctx, patient):
    with ctx():
        charge(patient, "a", 10_000, quantity=3)
        line = charge(patient, "b", 2_550)
        invoice = invoice_of(line)
    assert (invoice.total_minor, invoice.net_due_minor, invoice.payment_status) == (
        32_550,
        32_550,
        "unpaid",
    )
    assert invoice.patient_due_minor == 32_550 and invoice.insurer_due_minor == 0


def test_charges_only_accept_money(ctx, patient):
    with ctx(), pytest.raises(TypeError):
        services.add_line(
            patient_id=patient.pk,
            source="x",
            source_id="1",
            description="x",
            quantity=1,
            unit_price=100.5,
            idempotency_key="float",
        )


def test_same_key_twice_never_bills_twice(ctx, patient):
    with ctx():
        first = charge(patient, "dup")
        second = charge(patient, "dup")
        services.finalise_line("test:dup")
        services.finalise_line("test:dup")
    assert first.pk == second.pk
    assert InvoiceLine.all_tenants.count() == 1
    assert JournalEntry.all_tenants.count() == 1
    assert invoice_of(first).total_minor == 10_000


# -- insurer and patient split ---------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "coverage_bp", "insurer_share", "patient_share"),
    [
        (10_000, 8_000, 8_000, 2_000),
        (999, 8_500, 850, 149),  # rounding: the remainder goes to the first share
        (1, 5_000, 1, 0),
        (12_345, 10_000, 12_345, 0),
        (12_345, 0, 0, 12_345),
    ],
)
def test_split_never_loses_a_minor_unit(
    ctx, patient, insurer, amount, coverage_bp, insurer_share, patient_share
):
    with ctx():
        line = charge(patient, "split", amount)
        services.set_coverage(invoice_of(line), insurer=insurer, coverage_bp=coverage_bp)
        line.refresh_from_db()
    assert (line.insurer_amount_minor, line.patient_amount_minor) == (insurer_share, patient_share)
    assert line.insurer_amount_minor + line.patient_amount_minor == amount


def test_coverage_applies_to_later_charges_and_is_fixed_once_paid(ctx, patient, insurer):
    with ctx():
        invoice = invoice_of(charge(patient, "one", 10_000))
        services.set_coverage(invoice, insurer=insurer, coverage_bp=7_000)
        later = charge(patient, "two", 5_000)
        assert (later.insurer_amount_minor, later.patient_amount_minor) == (3_500, 1_500)
        services.record_payment(invoice, payer="patient", method="cash", amount=ngn(1_000))
        with pytest.raises(DomainError):
            services.set_coverage(invoice, insurer=insurer, coverage_bp=5_000)


# -- payments and status ---------------------------------------------------------------


def test_partial_payments_move_the_status_to_paid(
    ctx, patient, insurer, django_capture_on_commit_callbacks
):
    with ctx():
        invoice = invoice_of(charge(patient, "visit", 10_000, delivered=True))
        services.record_payment(invoice, payer="patient", method="cash", amount=ngn(4_000))
        invoice.refresh_from_db()
        assert (invoice.payment_status, invoice.net_due_minor) == ("partially_paid", 6_000)
        with django_capture_on_commit_callbacks() as callbacks:
            services.record_payment(invoice, payer="patient", method="card", amount=ngn(6_000))
        invoice.refresh_from_db()
    assert (invoice.payment_status, invoice.net_due_minor) == ("paid", 0)
    assert invoice.paid_at is not None
    assert len(callbacks) == 1  # invoice.paid published once


@pytest.mark.parametrize(
    ("payer", "method", "amount", "currency"),
    [
        ("patient", "cash", 2_001, "NGN"),  # more than the patient's share
        ("insurer", "insurer_remittance", 8_001, "NGN"),  # more than the insurer's share
        ("patient", "insurer_remittance", 100, "NGN"),  # wrong method for the payer
        ("patient", "cash", 100, "USD"),  # wrong currency
        ("patient", "cash", 0, "NGN"),
    ],
)
def test_payments_are_checked(ctx, patient, insurer, payer, method, amount, currency):
    from apps.core.money import Money

    with ctx():
        invoice = invoice_of(charge(patient, "visit", 10_000))
        services.set_coverage(invoice, insurer=insurer, coverage_bp=8_000)
        with pytest.raises(DomainError):
            services.record_payment(
                invoice, payer=payer, method=method, amount=Money(amount, currency)
            )
    assert not Payment.all_tenants.exists()


def test_retried_payment_is_recorded_once(ctx, patient):
    with ctx():
        invoice = invoice_of(charge(patient, "visit", 10_000))
        first = services.record_payment(
            invoice, payer="patient", method="transfer", amount=ngn(5_000), idempotency_key="pos-77"
        )
        again = services.record_payment(
            invoice, payer="patient", method="transfer", amount=ngn(5_000), idempotency_key="pos-77"
        )
        invoice.refresh_from_db()
    assert first.pk == again.pk
    assert invoice.net_due_minor == 5_000


# -- the ledger --------------------------------------------------------------------------


def entry_lines(source):
    return sorted(
        (line.account.code, line.debit_minor, line.credit_minor)
        for line in JournalLine.all_tenants.filter(entry__source=source).select_related("account")
    )


def test_delivered_charge_debits_receivable_and_credits_revenue(ctx, patient, insurer):
    with ctx():
        line = charge(patient, "drug", 10_000)
        services.set_coverage(invoice_of(line), insurer=insurer, coverage_bp=8_000)
        services.finalise_line("test:drug")
    assert entry_lines("billing.invoiceline") == [
        ("1100", 2_000, 0),  # receivable from the patient
        ("1110", 8_000, 0),  # receivable from the insurer
        ("4000", 0, 10_000),  # pharmacy revenue
    ]


def test_paid_invoice_debits_cash_or_bank_and_credits_receivable(ctx, patient, insurer):
    with ctx():
        line = charge(patient, "drug", 10_000)
        invoice = invoice_of(line)
        services.set_coverage(invoice, insurer=insurer, coverage_bp=8_000)
        services.finalise_line("test:drug")
        services.record_payment(invoice, payer="patient", method="cash", amount=ngn(2_000))
        services.record_payment(
            invoice, payer="insurer", method="insurer_remittance", amount=ngn(8_000)
        )
        invoice.refresh_from_db()
        balances = ledger.balances()
    assert invoice.payment_status == "paid"
    assert entry_lines("billing.payment") == [
        ("1000", 2_000, 0),  # cash
        ("1010", 8_000, 0),  # bank
        ("1100", 0, 2_000),
        ("1110", 0, 8_000),
    ]
    assert balances["1100"] == balances["1110"] == 0  # nothing left receivable
    assert balances["1000"] + balances["1010"] == 10_000
    assert balances["4000"] == -10_000


def test_ledger_refuses_unbalanced_entries_in_code(ctx):
    with ctx(), pytest.raises(ledger.UnbalancedEntry):
        ledger.post(
            description="bad",
            source="test",
            source_id="1",
            idempotency_key="bad",
            lines=[("1000", ngn(100), ngn(0)), ("4900", ngn(0), ngn(99))],
        )


def test_database_refuses_an_unbalanced_entry_at_commit(ctx, tenant_a):
    with ctx():
        good = ledger.post(
            description="good",
            source="test",
            source_id="1",
            idempotency_key="good",
            lines=[("1000", ngn(100), ngn(0)), ("4900", ngn(0), ngn(100))],
        )
        cash = ledger.account("1000")
    with pytest.raises(DatabaseError, match="does not balance"), transaction.atomic():
        JournalLine.all_tenants.create(
            tenant=tenant_a, entry=good, account=cash, debit_minor=5, credit_minor=0
        )
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


@pytest.mark.parametrize(
    "sql",
    ["UPDATE billing_journalline SET debit_minor = 1", "DELETE FROM billing_journalentry"],
)
def test_ledger_is_append_only(ctx, patient, sql):
    with ctx():
        charge(patient, "x", delivered=True)
    with pytest.raises(DatabaseError, match="append-only"), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(sql)


def test_delivered_or_overpaying_voids_are_refused(ctx, patient):
    with ctx():
        charge(patient, "done", delivered=True)
        with pytest.raises(DomainError):
            services.void_line("test:done")
        line = charge(patient, "pending", 10_000)
        services.record_payment(
            invoice_of(line), payer="patient", method="cash", amount=ngn(15_000)
        )
        with pytest.raises(DomainError):
            services.void_line("test:pending")


# -- reconciliation on a seeded dataset ------------------------------------------------


@pytest.fixture
def seeded(ctx, make_patient, insurer):
    """Patients with insured and uninsured bills, partial payments, voids and pending items."""
    with ctx():
        a, b, c, d = (make_patient(name) for name in ("Ada", "Bayo", "Chidi", "Dayo"))
        inv_a = invoice_of(charge(a, "a1", 12_345))
        services.set_coverage(inv_a, insurer=insurer, coverage_bp=8_500)
        charge(a, "a2", 999, quantity=3, category="laboratory")
        services.finalise_line("test:a1")
        services.finalise_line("test:a2")
        services.record_payment(
            inv_a, payer="insurer", method="insurer_remittance", amount=ngn(5_000)
        )

        inv_b = invoice_of(charge(b, "b1", 50_000, category="consultation", delivered=True))
        services.record_payment(inv_b, payer="patient", method="cash", amount=ngn(50_000))
        charge(b, "b2", 7_500)  # new charge after payment: goes to a new invoice

        charge(c, "c1", 20_000)
        charge(c, "c2", 3_000)
        services.void_line("test:c2")
        services.record_payment(
            invoice_of(charge(c, "c3", 1)), payer="patient", method="card", amount=ngn(1)
        )

        inv_d = invoice_of(charge(d, "d1", 40_000, category="ward", delivered=True))
        services.record_payment(inv_d, payer="patient", method="transfer", amount=ngn(10_000))
    return {"a": inv_a, "b": inv_b, "d": inv_d}


def test_seeded_dataset_reconciles(ctx, seeded):
    with ctx():
        assert services.reconcile() == []
        debits, credits = ledger.trial_balance()
        balances = ledger.balances()
    assert debits == credits
    assert sum(balances.values()) == 0
    assert Invoice.all_tenants.get(pk=seeded["b"].pk).payment_status == "paid"
    assert Invoice.all_tenants.filter(patient_id=seeded["b"].patient_id).count() == 2
    call_command("reconcile_billing")


def test_reconciliation_detects_a_tampered_total(ctx, seeded):
    Invoice.all_tenants.filter(pk=seeded["d"].pk).update(net_due_minor=1)
    with ctx():
        problems = services.reconcile()
    assert any("net due" in p for p in problems)


# -- API -------------------------------------------------------------------------------


def test_billing_officer_sets_coverage_and_takes_payment(billing, ctx, patient, insurer):
    with ctx():
        invoice = invoice_of(charge(patient, "api", 20_000, delivered=True))
    url = f"/api/billing/invoices/{invoice.pk}/"
    response = billing.post(
        f"{url}coverage/", {"insurer": str(insurer.pk), "coverage_bp": 5_000}, format="json"
    )
    assert response.status_code == 409  # a charge is already final
    response = billing.post(
        f"{url}pay/",
        {"payer": "patient", "method": "cash", "amount_minor": 20_000, "idempotency_key": "till-1"},
        format="json",
    )
    assert response.status_code == 201, response.json()
    assert billing.get(url).json()["payment_status"] == "paid"


def test_manual_charge_through_the_api(billing, ctx, patient):
    with ctx():
        invoice = invoice_of(charge(patient, "base", 1_000))
    response = billing.post(
        f"/api/billing/invoices/{invoice.pk}/charge/",
        {
            "description": "Registration card",
            "quantity": 1,
            "unit_price_minor": 2_000,
            "revenue_category": "other",
        },
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["status"] == "final"
    assert billing.get(f"/api/billing/invoices/{invoice.pk}/").json()["total_minor"] == 3_000


def test_finance_reads_the_ledger_and_reconciliation(finance, seeded):
    accounts = {
        a["code"]: a["balance_minor"]
        for a in finance.get("/api/billing/ledger/accounts/").json()["results"]
    }
    assert accounts["4100"] == -50_000
    assert finance.get("/api/billing/ledger/accounts/reconcile/").json() == {
        "reconciled": True,
        "problems": [],
    }
    trial = finance.get("/api/billing/ledger/accounts/trial-balance/").json()
    assert trial["debits_minor"] == trial["credits_minor"]
    assert finance.get("/api/billing/ledger/entries/").status_code == 200


@pytest.mark.parametrize("role", [Role.DOCTOR, Role.NURSE, Role.PHARMACIST])
def test_sec_02_clinical_roles_see_no_bills(role, make_user, tenant_a, signed_in):
    client = signed_in(make_user("someone", tenant_a, [role]))
    assert client.get("/api/billing/invoices/").status_code == 403
    assert client.get("/api/billing/ledger/accounts/").status_code == 403


def test_sec_02_front_desk_views_bills_but_cannot_take_payment(
    make_user, tenant_a, signed_in, ctx, patient
):
    with ctx():
        invoice = invoice_of(charge(patient, "desk", 1_000))
    desk = signed_in(make_user("desk", tenant_a, [Role.FRONT_DESK]))
    assert desk.get(f"/api/billing/invoices/{invoice.pk}/").status_code == 200
    response = desk.post(
        f"/api/billing/invoices/{invoice.pk}/pay/",
        {"payer": "patient", "method": "cash", "amount_minor": 1_000},
        format="json",
    )
    assert response.status_code == 403
    assert desk.get("/api/billing/ledger/accounts/").status_code == 403
