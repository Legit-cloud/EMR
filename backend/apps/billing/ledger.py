"""General ledger: the chart of accounts and balanced double-entry postings."""

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.money import Money

from .models import Account, AccountType, JournalEntry, JournalLine, RevenueCategory

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
}


class UnbalancedEntry(ValueError):
    pass


def account(code: str) -> Account:
    """The tenant's account, created from the standard chart on first use."""
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


def balances(currency: str = "NGN") -> dict[str, int]:
    """Debit-positive balance per account code, in minor units."""
    rows = (
        JournalLine.objects.filter(entry__currency=currency)
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
