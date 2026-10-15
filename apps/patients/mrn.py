"""Medical record numbers: registration year plus a per-tenant sequence, e.g. 2026-000042."""

from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

_NEXT_VALUE_SQL = """
INSERT INTO patients_mrnsequence (tenant_id, year, last_value)
VALUES (%s, %s, 1)
ON CONFLICT (tenant_id, year)
DO UPDATE SET last_value = patients_mrnsequence.last_value + 1
RETURNING last_value
"""


def registration_year() -> int:
    return timezone.now().astimezone(ZoneInfo(settings.MRN_TIME_ZONE)).year


def next_mrn(tenant_id) -> str:
    """Take the next MRN for the tenant.

    One atomic upsert: concurrent callers queue on the counter row, so no two get the
    same value. It must run inside the transaction that saves the patient; if that
    transaction rolls back, the number was never issued and is handed out next, so no
    patient's MRN is ever reused.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("next_mrn must run inside the transaction that saves the patient")
    year = registration_year()
    with connection.cursor() as cursor:
        cursor.execute(_NEXT_VALUE_SQL, [tenant_id, year])
        (value,) = cursor.fetchone()
    return f"{year}-{value:0{settings.MRN_SEQUENCE_DIGITS}d}"
