"""Write audit entries. Every module records PHI access and changes through ``record``."""

import hashlib
import json
import uuid

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.utils import timezone

from apps.core.tenancy import get_current_tenant_id

from .models import AuditAction, AuditEntry, AuditOutcome

GENESIS_HASH = "0" * 64
_HASHED_FIELDS = (
    "id",
    "tenant_id",
    "sequence",
    "occurred_at",
    "actor_id",
    "actor_label",
    "action",
    "outcome",
    "resource",
    "object_id",
    "reason",
    "ip_address",
    "user_agent",
    "method",
    "path",
    "details",
    "previous_hash",
)
_UNSET = object()

__all__ = ["AuditAction", "AuditOutcome", "client_ip", "compute_hash", "record", "verify_chain"]


def client_ip(request) -> str | None:
    meta = request.META
    if settings.AUDIT_TRUST_X_FORWARDED_FOR and meta.get("HTTP_X_FORWARDED_FOR"):
        return meta["HTTP_X_FORWARDED_FOR"].split(",")[0].strip() or None
    return meta.get("REMOTE_ADDR") or None


def compute_hash(entry: AuditEntry) -> str:
    data = {name: getattr(entry, name) for name in _HASHED_FIELDS}
    canonical = json.dumps(data, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _chain_lock_key(tenant_id) -> int:
    digest = hashlib.sha256(f"audit:{tenant_id or 'platform'}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def record(
    *,
    action: str,
    outcome: str = AuditOutcome.ALLOWED,
    request=None,
    actor=None,
    tenant_id=_UNSET,
    resource: str = "",
    object_id="",
    reason: str = "",
    details: dict | None = None,
) -> AuditEntry:
    """Append one entry to the tenant's chain.

    ``actor`` defaults to the authenticated user of ``request``; ``tenant_id`` defaults to
    the current tenant context. Store identifiers in ``details``, never clinical content.
    """
    if actor is None and request is not None:
        user = getattr(request, "user", None)
        actor = user if user is not None and user.is_authenticated else None
    if tenant_id is _UNSET:
        tenant_id = get_current_tenant_id()
        if tenant_id is None and actor is not None:
            tenant_id = getattr(actor, "tenant_id", None)

    entry = AuditEntry(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(str(tenant_id)) if tenant_id else None,
        occurred_at=timezone.now(),
        actor_id=actor.pk if actor is not None else None,
        actor_label=actor.get_username()[:150] if actor is not None else "",
        action=action,
        outcome=outcome,
        resource=resource,
        object_id=str(object_id or "")[:64],
        reason=reason or "",
        details=json.loads(json.dumps(details or {}, cls=DjangoJSONEncoder)),
    )
    if request is not None:
        entry.ip_address = client_ip(request)
        entry.user_agent = request.META.get("HTTP_USER_AGENT", "")[:255]
        entry.method = request.method or ""
        entry.path = request.path[:500]

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [_chain_lock_key(entry.tenant_id)])
        last = (
            AuditEntry.objects.filter(tenant_id=entry.tenant_id)
            .order_by("-sequence")
            .values("sequence", "entry_hash")
            .first()
        )
        entry.sequence = last["sequence"] + 1 if last else 1
        entry.previous_hash = last["entry_hash"] if last else GENESIS_HASH
        entry.entry_hash = compute_hash(entry)
        entry.save(force_insert=True)
    return entry


def verify_chain(tenant_id=None) -> list[str]:
    """Return a list of problems in one chain; an empty list means it is intact."""
    problems = []
    expected_previous = GENESIS_HASH
    expected_sequence = 1
    entries = AuditEntry.objects.filter(tenant_id=tenant_id).order_by("sequence")
    for entry in entries.iterator():
        if entry.sequence != expected_sequence:
            problems.append(f"sequence gap before {entry.sequence} (expected {expected_sequence})")
        if entry.previous_hash != expected_previous:
            problems.append(f"entry {entry.sequence} does not link to the previous entry")
        if compute_hash(entry) != entry.entry_hash:
            problems.append(f"entry {entry.sequence} was altered")
        expected_previous = entry.entry_hash
        expected_sequence = entry.sequence + 1
    return problems
