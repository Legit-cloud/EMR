"""General ledger: the chart of accounts and balanced double-entry postings."""

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.money import Money

from .models import Account, AccountType, JournalEntry, JournalLine, RevenueCategory

# Postings finance makes by hand, and their reversals. Not explained by invoices or payments.
MANUAL_SOURCES = ("manual", "reversal")
CASH = "1000"
BANK = "1010"
AR_PATIENTS = "1100"
AR_INSURERS = "1110"
REVENUE = {
    RevenueCategory.PHARMACY: "4000",
    RevenueCategory.CONSULTATION: "4100",
    RevenueCategory.LABORATORY: "4200",
    RevenueCategory.IMAGING: "4300",
    RevenueCategory.WARD: "4400",
    RevenueCategory.PROCEDURE: "4500",
    RevenueCategory.OTHER: "4900",
}

CHART = {
    CASH: ("Cash on hand", AccountType.ASSET),
    BANK: ("Bank", AccountType.ASSET),
    AR_PATIENTS: ("Accounts receivable - patients", AccountType.ASSET),
    AR_INSURERS: ("Accounts receivable - insurers", AccountType.ASSET),
    "4000": ("Revenue - pharmacy", AccountType.REVENUE),
    "4100": ("Revenue - consultations", AccountType.REVENUE),
    "4200": ("Revenue - laboratory", AccountType.REVENUE),
    "4300": ("Revenue - imaging", AccountType.REVENUE),
    "4400": ("Revenue - ward and bed", AccountType.REVENUE),
    "4500": ("Revenue - procedures", AccountType.REVENUE),
    "4900": ("Revenue - other services", AccountType.REVENUE),
    # Accounts for money going out, used by manual entries (ADR 0026).
    "2000": ("Accounts payable", AccountType.LIABILITY),
    "3000": ("Owner's equity", AccountType.EQUITY),
    "5100": ("Salaries and wages", AccountType.EXPENSE),
    "5200": ("Medical and general supplies", AccountType.EXPENSE),
    "5300": ("Utilities and rent", AccountType.EXPENSE),
    "5900": ("Other expenses", AccountType.EXPENSE),
}


class UnbalancedEntry(ValueError):
    pass


def account(code: str) -> Account:
    """The tenant's account, created from the standard chart on first use."""
    found = Account.objects.filter(code=code).first()
    if found:
        return found
    name, account_type = CHART[code]
    found, _ = Account.objects.get_or_create(
        code=code, defaults={"name": name, "account_type": account_type}
    )
    return found


@transaction.atomic
def post(
    *,
    description: str,
    source: str,
    source_id,
    idempotency_key: str,
    lines: list[tuple[str, Money, Money]],
) -> JournalEntry:
    """Post one entry. ``lines`` are ``(account code, debit, credit)``; zero lines are dropped.

    Idempotent on ``idempotency_key``. Debits must equal credits (also enforced by the
    database at commit).
    """
    existing = JournalEntry.objects.filter(idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing
    lines = [(code, dr, cr) for code, dr, cr in lines if not (dr.is_zero() and cr.is_zero())]
    if not lines:
        raise UnbalancedEntry("An entry needs at least one non-zero line.")
    currency = lines[0][1].currency
    debits = sum((dr for _, dr, _ in lines), Money.zero(currency))
    credits = sum((cr for _, _, cr in lines), Money.zero(currency))
    if debits != credits:
        raise UnbalancedEntry(f"Debits {debits} do not equal credits {credits}.")
    try:
        with transaction.atomic():
            entry = JournalEntry.objects.create(
                posted_at=timezone.now(),
                description=description[:255],
                source=source,
                source_id=str(source_id),
                idempotency_key=idempotency_key,
                currency=currency,
            )
    except IntegrityError:
        return JournalEntry.objects.get(idempotency_key=idempotency_key)
    JournalLine.objects.bulk_create(
        JournalLine(
            entry=entry,
            account=account(code),
            debit_minor=dr.amount_minor,
            credit_minor=cr.amount_minor,
        )
        for code, dr, cr in lines
    )
    return entry


def balances(currency: str = "NGN", *, exclude_sources: tuple = ()) -> dict[str, int]:
    """Debit-positive balance per account code, in minor units."""
    rows = (
        JournalLine.objects.filter(entry__currency=currency)
        .exclude(entry__source__in=exclude_sources)
        .values("account__code")
        .annotate(debit=Sum("debit_minor"), credit=Sum("credit_minor"))
    )
    return {row["account__code"]: row["debit"] - row["credit"] for row in rows}


def trial_balance(currency: str = "NGN") -> tuple[int, int]:
    """Total debits and total credits of every posting; equal when the books balance."""
    totals = JournalLine.objects.filter(entry__currency=currency).aggregate(
        debit=Sum("debit_minor"), credit=Sum("credit_minor")
    )
    return totals["debit"] or 0, totals["credit"] or 0


def _by_account(entry_filter: dict) -> list[dict]:
    rows = (
        JournalLine.objects.filter(**entry_filter)
        .values("account__code", "account__name", "account__account_type")
        .annotate(debit=Sum("debit_minor"), credit=Sum("credit_minor"))
        .order_by("account__code")
    )
    return [
        {
            "code": r["account__code"],
            "name": r["account__name"],
            "type": r["account__account_type"],
            "debit": r["debit"],
            "credit": r["credit"],
        }
        for r in rows
    ]


def income_statement(start, end, currency: str = "NGN") -> dict:
    """Revenue less expenses posted from ``start`` to ``end``, both dates inclusive."""
    rows = _by_account(
        {
            "entry__currency": currency,
            "entry__posted_at__date__gte": start,
            "entry__posted_at__date__lte": end,
            "account__account_type__in": [AccountType.REVENUE, AccountType.EXPENSE],
        }
    )
    revenue = [
        {"code": r["code"], "name": r["name"], "amount_minor": r["credit"] - r["debit"]}
        for r in rows
        if r["type"] == AccountType.REVENUE
    ]
    expenses = [
        {"code": r["code"], "name": r["name"], "amount_minor": r["debit"] - r["credit"]}
        for r in rows
        if r["type"] == AccountType.EXPENSE
    ]
    total_revenue = sum(r["amount_minor"] for r in revenue)
    total_expenses = sum(r["amount_minor"] for r in expenses)
    return {
        "start": start,
        "end": end,
        "currency": currency,
        "revenue": revenue,
        "expenses": expenses,
        "total_revenue_minor": total_revenue,
        "total_expenses_minor": total_expenses,
        "net_minor": total_revenue - total_expenses,
    }


def balance_sheet(as_of, currency: str = "NGN") -> dict:
    """Assets, liabilities and equity as at the end of ``as_of``. Profit to date (revenue less
    expenses) is shown as part of equity, so assets always equal liabilities plus equity."""
    rows = _by_account({"entry__currency": currency, "entry__posted_at__date__lte": as_of})
    groups = {AccountType.ASSET: [], AccountType.LIABILITY: [], AccountType.EQUITY: []}
    profit = 0
    for r in rows:
        net = r["debit"] - r["credit"]
        if r["type"] == AccountType.ASSET:
            groups[AccountType.ASSET].append(
                {"code": r["code"], "name": r["name"], "amount_minor": net}
            )
        elif r["type"] in (AccountType.LIABILITY, AccountType.EQUITY):
            groups[r["type"]].append({"code": r["code"], "name": r["name"], "amount_minor": -net})
        else:
            profit -= net
    total = {k: sum(x["amount_minor"] for x in v) for k, v in groups.items()}
    return {
        "as_of": as_of,
        "currency": currency,
        "assets": groups[AccountType.ASSET],
        "liabilities": groups[AccountType.LIABILITY],
        "equity": groups[AccountType.EQUITY],
        "profit_to_date_minor": profit,
        "total_assets_minor": total[AccountType.ASSET],
        "total_liabilities_minor": total[AccountType.LIABILITY],
        "total_equity_minor": total[AccountType.EQUITY] + profit,
    }
