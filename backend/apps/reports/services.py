"""The dashboard: totals for the cards each user may see.

Every card is computed only when the user's role sees the underlying data across the whole
tenant (``policy.can_tenant_wide``); otherwise it is ``None`` and the web app leaves the card
out. Figures are totals, never rows, so no patient is identifiable from them.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models.functions import TruncDate, TruncMonth

from apps.billing import selectors as billing
from apps.clinical import selectors as clinical
from apps.core import policy
from apps.core.roles import Role
from apps.diagnostics import selectors as diagnostics
from apps.inpatient import selectors as inpatient
from apps.patients import selectors as patients
from apps.pharmacy import selectors as pharmacy
from apps.scheduling import selectors as scheduling
from apps.staff import selectors as staff

RANGES = {"12m": "Last 12 months", "30d": "Last 30 days"}
LICENCE_WARNING_DAYS = 60


def _zone() -> ZoneInfo:
    return ZoneInfo(settings.REPORTING_TIME_ZONE)


def _periods(range_key: str, today: date) -> tuple[list[date], datetime, datetime, object]:
    """Period starts, the range [start, end) as aware datetimes, and the Trunc to group by."""
    zone = _zone()
    if range_key == "12m":
        first = date(today.year, today.month, 1)
        starts = []
        for back in range(11, -1, -1):
            month = first.month - back
            year = first.year + (month - 1) // 12
            starts.append(date(year, (month - 1) % 12 + 1, 1))
        last = starts[-1]
        end_day = date(last.year + last.month // 12, last.month % 12 + 1, 1)
        trunc = lambda field: TruncMonth(field, tzinfo=zone)  # noqa: E731
    else:
        starts = [today - timedelta(days=back) for back in range(29, -1, -1)]
        end_day = today + timedelta(days=1)
        trunc = lambda field: TruncDate(field, tzinfo=zone)  # noqa: E731
    start = datetime.combine(starts[0], time.min, zone)
    end = datetime.combine(end_day, time.min, zone)
    return starts, start, end, trunc


def _key(value) -> date:
    return value.date() if isinstance(value, datetime) else value


def _finance(range_key, today, currency):
    starts, start, end, trunc = _periods(range_key, today)
    collected = {
        _key(k): v for k, v in billing.collected_by_period(start, end, currency, trunc).items()
    }
    billed = {_key(k): v for k, v in billing.billed_by_period(start, end, currency, trunc).items()}
    previous_start = start - (end - start)
    previous = sum(billing.collected_by_period(previous_start, start, currency, trunc).values())
    return {
        "currency": currency,
        "periods": [
            {
                "start": period,
                "collected_minor": collected.get(period, 0),
                "billed_minor": billed.get(period, 0),
            }
            for period in starts
        ],
        "collected_minor": sum(collected.values()),
        "previous_collected_minor": previous,
        "revenue_mix": billing.revenue_by_category(start, end, currency),
    }


def _patients(range_key, today):
    _, start, end, _ = _periods(range_key, today)
    seen = scheduling.attended_patient_ids(start, end)
    returning = patients.registered_before_count(seen, start)
    return {"new": len(seen) - returning, "returning": returning}


def _my_day(user, today, reviews_results):
    expires = staff.licence_expiry(user.pk)
    days_left = (expires - today).days if expires else None
    return {
        "open_notes": clinical.open_note_count(user.pk),
        "draft_prescriptions": pharmacy.draft_prescription_count(user.pk),
        "results_to_review": diagnostics.unreviewed_result_count() if reviews_results else None,
        "licence_expires_on": expires
        if days_left is not None and days_left <= LICENCE_WARNING_DAYS
        else None,
    }


def dashboard(user, subject: policy.Subject, range_key: str) -> dict:
    today = datetime.now(_zone()).date()
    currency = settings.REPORTING_CURRENCY

    def sees(name: str) -> bool:
        return policy.can_tenant_wide(subject, policy.get_resource(name))

    _, start, end, _ = _periods(range_key, today)
    clinician = bool(subject.roles & {Role.DOCTOR, Role.NURSE})
    return {
        "range": range_key,
        "finance": _finance(range_key, today, currency) if sees("billing.payment") else None,
        "patients": _patients(range_key, today)
        if sees("scheduling.appointment") and sees("patients.patient")
        else None,
        "popular_services": billing.popular_services(start, end)
        if sees("billing.invoice")
        else None,
        "stock": pharmacy.stock_summary(today, currency) if sees("pharmacy.stockbatch") else None,
        "my_day": _my_day(user, today, Role.DOCTOR in subject.roles) if clinician else None,
        "wards": inpatient.bed_summary() if sees("inpatient.admission") else None,
        "diagnostics": {
            "open_orders": diagnostics.open_order_count(),
            "results_to_review": diagnostics.unreviewed_result_count(),
        }
        if sees("diagnostics.order")
        else None,
        "claims": billing.claim_ageing() if sees("billing.claim") else None,
    }
