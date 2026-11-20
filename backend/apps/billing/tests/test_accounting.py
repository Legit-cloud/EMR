"""Accounting: manual entries, reversals, income statement and balance sheet.
Requirement IDs: SEC-02, SEC-03, SEC-07, FR-ACC (double entry always balances)."""

import pytest
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.billing import ledger
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context

pytestmark = pytest.mark.django_db

ENTRIES = "/api/billing/ledger/entries/"
ACCOUNTS = "/api/billing/ledger/accounts/"


def entry(
    description="Paid the generator fuel supplier", amount=500_000, debit="5300", credit="1000"
):
    return {
        "description": description,
        "currency": "NGN",
        "lines": [
            {"account": debit, "debit_minor": amount},
            {"account": credit, "credit_minor": amount},
        ],
    }


def test_finance_posts_a_balanced_manual_entry(finance):
    response = finance.post(ENTRIES, entry(), format="json")
    assert response.status_code == 201
    body = response.json()
    assert body["source"] == "manual"
    assert sorted(line["account"] for line in body["lines"]) == ["1000", "5300"]
    assert finance.get(f"{ACCOUNTS}reconcile/").json()["reconciled"] is True


def test_unbalanced_or_malformed_entries_are_refused_and_post_nothing(finance):
    unbalanced = entry()
    unbalanced["lines"][1]["credit_minor"] = 400_000
    assert finance.post(ENTRIES, unbalanced, format="json").status_code == 400
    both_sides = entry()
    both_sides["lines"][0]["credit_minor"] = 5
    assert finance.post(ENTRIES, both_sides, format="json").status_code == 400
    assert finance.post(ENTRIES, entry(debit="9999"), format="json").status_code == 400
    assert finance.post(ENTRIES, entry(description=" "), format="json").status_code == 400
    assert finance.get(ENTRIES).json()["results"] == []


def test_reversal_mirrors_the_entry_once_and_cannot_be_reversed(finance):
    original = finance.post(ENTRIES, entry(), format="json").json()["id"]
    assert (
        finance.post(f"{ENTRIES}{original}/reverse/", {"reason": ""}, format="json").status_code
        == 400
    )
    reversal = finance.post(
        f"{ENTRIES}{original}/reverse/", {"reason": "Wrong account"}, format="json"
    )
    assert reversal.status_code == 201
    again = finance.post(
        f"{ENTRIES}{original}/reverse/", {"reason": "Wrong account"}, format="json"
    )
    assert again.json()["id"] == reversal.json()["id"]
    trial = finance.get(f"{ACCOUNTS}trial-balance/").json()
    assert trial["debits_minor"] == trial["credits_minor"] == 1_000_000
    balances = ledger_balances(finance)
    assert balances.get("5300", 0) == 0 and balances.get("1000", 0) == 0
    assert (
        finance.post(
            f"{ENTRIES}{reversal.json()['id']}/reverse/", {"reason": "x"}, format="json"
        ).status_code
        == 400
    )


def ledger_balances(client):
    rows = client.get(ACCOUNTS).json()["results"]
    return {r["code"]: r["balance_minor"] for r in rows}


def test_income_statement_and_balance_sheet_tie_out(finance, tenant_a):
    # Revenue 1,000,000 on credit then collected; 300,000 of expenses paid in cash; 100,000
    # of supplies bought on account; 2,000,000 put in as equity.
    with tenant_context(tenant_a.id):
        n = lambda k: Money(k, "NGN")  # noqa: E731
        zero = Money.zero("NGN")
        ledger.post(
            description="Equity",
            source="t",
            source_id=1,
            idempotency_key="t1",
            lines=[("1010", n(2_000_000), zero), ("3000", zero, n(2_000_000))],
        )
        ledger.post(
            description="Service",
            source="t",
            source_id=2,
            idempotency_key="t2",
            lines=[("1100", n(1_000_000), zero), ("4100", zero, n(1_000_000))],
        )
        ledger.post(
            description="Collected",
            source="t",
            source_id=3,
            idempotency_key="t3",
            lines=[("1000", n(1_000_000), zero), ("1100", zero, n(1_000_000))],
        )
    assert (
        finance.post(ENTRIES, entry(amount=300_000, debit="5100"), format="json").status_code == 201
    )
    assert (
        finance.post(
            ENTRIES, entry("Gloves bought", 100_000, "5200", "2000"), format="json"
        ).status_code
        == 201
    )

    today = timezone.localdate().isoformat()
    income = finance.get(f"{ACCOUNTS}income-statement/?start={today}&end={today}").json()
    assert income["total_revenue_minor"] == 1_000_000
    assert income["total_expenses_minor"] == 400_000
    assert income["net_minor"] == 600_000

    sheet = finance.get(f"{ACCOUNTS}balance-sheet/?as_of={today}").json()
    assert sheet["total_assets_minor"] == 2_000_000 + 1_000_000 - 300_000
    assert sheet["total_liabilities_minor"] == 100_000
    assert sheet["profit_to_date_minor"] == 600_000
    assert (
        sheet["total_assets_minor"]
        == sheet["total_liabilities_minor"] + sheet["total_equity_minor"]
    )


def test_income_statement_outside_the_period_is_empty(finance):
    finance.post(ENTRIES, entry(), format="json")
    income = finance.get(f"{ACCOUNTS}income-statement/?start=2020-01-01&end=2020-01-31").json()
    assert income["expenses"] == [] and income["net_minor"] == 0
    assert finance.get(f"{ACCOUNTS}income-statement/?start=nonsense").status_code == 400


def test_sec_02_only_finance_posts_the_tenant_admin_and_billing_officer_cannot(
    finance, make_user, signed_in, tenant_a
):
    admin = signed_in(make_user("adm-acc", tenant_a, [Role.TENANT_ADMIN]))
    officer = signed_in(make_user("off-acc", tenant_a, [Role.BILLING_OFFICER]))
    original = finance.post(ENTRIES, entry(), format="json").json()["id"]
    assert admin.get(ENTRIES).status_code == 200
    assert admin.get(f"{ACCOUNTS}balance-sheet/").status_code == 200
    for client in (admin, officer):
        assert client.post(ENTRIES, entry(), format="json").status_code == 403
        assert client.post(
            f"{ENTRIES}{original}/reverse/", {"reason": "x"}, format="json"
        ).status_code in (403, 404)
    assert officer.get(f"{ACCOUNTS}income-statement/").status_code == 403


def test_sec_03_manual_entries_and_reversals_are_audited(finance):
    original = finance.post(ENTRIES, entry(), format="json").json()["id"]
    finance.post(f"{ENTRIES}{original}/reverse/", {"reason": "Mistake"}, format="json")
    assert AuditEntry.objects.filter(resource="billing.journalentry", action="create").count() == 2


def test_sec_07_other_tenant_sees_nothing(finance, make_user, signed_in, tenant_b):
    finance.post(ENTRIES, entry(), format="json")
    other = signed_in(make_user("fin-b", tenant_b, [Role.FINANCE]))
    assert other.get(ENTRIES).json()["results"] == []
    assert other.get(f"{ACCOUNTS}income-statement/").json()["net_minor"] == 0
