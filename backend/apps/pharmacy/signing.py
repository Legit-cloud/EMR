"""Tamper-evident prescription signatures (SEC-09).

At authorisation the prescription is reduced to a canonical JSON payload (who, for whom,
when, every item, every overridden alert) and signed with Ed25519. Verification rebuilds
the payload from the database and checks the signature, so any later change to the
prescription, its items or its overrides is detected. Verifying needs only the public key.

Keys: ``PRESCRIPTION_SIGNING_KEY`` is a base64 Ed25519 private key (32 bytes) per
environment. ``PRESCRIPTION_RETIRED_PUBLIC_KEYS`` keeps old public keys after rotation
so earlier signatures still verify.
"""

import base64
import hashlib
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

# Unscoped on purpose: verification must give the same answer in a request, a Celery task
# or an audit script. The prescription itself was already reached through tenant checks.
from .models import PrescriptionAlert, PrescriptionItem


def _private_key() -> Ed25519PrivateKey:
    raw = settings.PRESCRIPTION_SIGNING_KEY
    if not raw:
        raise ImproperlyConfigured("PRESCRIPTION_SIGNING_KEY is not set.")
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))


def _public_bytes(key: Ed25519PublicKey) -> bytes:
    return key.public_bytes(Encoding.Raw, PublicFormat.Raw)


def key_id(public_key: Ed25519PublicKey) -> str:
    return hashlib.sha256(_public_bytes(public_key)).hexdigest()[:16]


def _verification_keys() -> dict[str, Ed25519PublicKey]:
    keys = [_private_key().public_key()]
    for encoded in settings.PRESCRIPTION_RETIRED_PUBLIC_KEYS:
        keys.append(Ed25519PublicKey.from_public_bytes(base64.b64decode(encoded)))
    return {key_id(key): key for key in keys}


def canonical_payload(prescription) -> bytes:
    items = [
        {
            "id": str(item.pk),
            "drug_id": str(item.drug_id),
            "drug": f"{item.drug.name} {item.drug.strength} {item.drug.form}",
            "dose": item.dose,
            "frequency": item.frequency,
            "route": item.route,
            "duration_days": item.duration_days,
            "quantity": item.quantity,
            "instructions": item.instructions,
        }
        for item in PrescriptionItem.all_tenants.filter(prescription_id=prescription.pk)
        .select_related("drug")
        .order_by("pk")
    ]
    overrides = [
        {"key": alert.key, "reason": alert.override_reason}
        for alert in PrescriptionAlert.all_tenants.filter(
            prescription_id=prescription.pk, blocking=True
        ).order_by("key")
    ]
    payload = {
        "prescription_id": str(prescription.pk),
        "tenant_id": str(prescription.tenant_id),
        "patient_id": str(prescription.patient_id),
        "encounter_id": str(prescription.encounter_id),
        "prescriber_id": str(prescription.prescriber_id),
        "authorised_at": prescription.authorised_at.isoformat(),
        "items": items,
        "overrides": overrides,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def sign(prescription) -> tuple[str, str, str]:
    """Return (signature, key id, payload sha256) for an authorised prescription."""
    private_key = _private_key()
    payload = canonical_payload(prescription)
    signature = base64.b64encode(private_key.sign(payload)).decode()
    return signature, key_id(private_key.public_key()), hashlib.sha256(payload).hexdigest()


def verify(prescription) -> bool:
    """True only if the stored signature matches the prescription as it is now."""
    if not prescription.signature:
        return False
    public_key = _verification_keys().get(prescription.signing_key_id)
    if public_key is None:
        return False
    try:
        public_key.verify(base64.b64decode(prescription.signature), canonical_payload(prescription))
    except (InvalidSignature, ValueError):
        return False
    return True
