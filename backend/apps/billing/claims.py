"""Insurer and HMO claims.

A claim follows one invoice that has an insurer. Draft, then Submitted; the insurer approves
all or part of it, or rejects it with a reason; a rejected claim can be corrected and sent
again. Money received is recorded as insurer payments on the invoice until the approved amount
is in, which makes the claim Paid. Nothing here edits an invoice line or the ledger directly.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.errors import DomainError
from apps.core.money import Money

from . import services
from .models import Claim, ClaimStatus, Invoice, LineStatus, Payer, Payment, PaymentMethod


class ClaimRefused(DomainError):
    code = "claim_refused"
    status_code = 409


def claim_reference(invoice: Invoice) -> str:
    return f"CLM-{str(invoice.pk)[:8].upper()}"


def _lock(claim: Claim) -> Claim:
    return Claim.objects.select_for_update().select_related("invoice").get(pk=claim.pk)


@transaction.atomic
def create_claim(invoice: Invoice) -> Claim:
    """Start a claim for the insurer share of an invoice."""
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.insurer_id is None:
        raise ClaimRefused("This invoice has no insurer.")
    if invoice.lines.filter(status=LineStatus.PENDING).exists():
        raise ClaimRefused("Some charges have not been delivered yet; claim when they are.")
    owed = invoice.insurer_due_minor - invoice.insurer_paid_minor
    if owed <= 0:
        raise ClaimRefused("The insurer owes nothing on this invoice.")
    try:
        with transaction.atomic():
            return Claim.objects.create(
                invoice=invoice,
                insurer_id=invoice.insurer_id,
                reference=claim_reference(invoice),
                currency=invoice.currency,
                claimed_minor=owed,
            )
    except IntegrityError:
        raise ClaimRefused("This invoice already has a claim.") from None


@transaction.atomic
def submit(claim: Claim, *, insurer_reference: str = "") -> Claim:
    """Send a draft, or send a rejected claim again. A resubmission claims what is still owed."""
    claim = _lock(claim)
    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.REJECTED):
        raise ClaimRefused(f"A {claim.get_status_display().lower()} claim cannot be submitted.")
    if claim.status == ClaimStatus.REJECTED:
        invoice = claim.invoice
        owed = invoice.insurer_due_minor - invoice.insurer_paid_minor
        if owed <= 0:
            raise ClaimRefused("The insurer owes nothing on this invoice any more.")
        claim.claimed_minor = owed
        claim.approved_minor = None
    claim.status = ClaimStatus.SUBMITTED
    claim.attempt += 1
    claim.submitted_at = timezone.now()
    claim.decided_at = None
    claim.decision_note = ""
    if insurer_reference.strip():
        claim.insurer_reference = insurer_reference.strip()
    claim.save()
    return claim


@transaction.atomic
def approve(claim: Claim, *, approved_minor: int, note: str = "") -> Claim:
    claim = _lock(claim)
    if claim.status != ClaimStatus.SUBMITTED:
        raise ClaimRefused("Only a submitted claim can be approved.")
    if not 0 < approved_minor <= claim.claimed_minor:
        raise ClaimRefused(
            "The approved amount must be more than nothing and at most "
            f"{Money(claim.claimed_minor, claim.currency)}."
        )
    note = note.strip()
    if approved_minor < claim.claimed_minor and len(note) < 5:
        raise ClaimRefused("Say why the insurer approved less than was claimed.")
    claim.status = ClaimStatus.APPROVED
    claim.approved_minor = approved_minor
    claim.decided_at = timezone.now()
    claim.decision_note = note
    claim.save()
    return claim


@transaction.atomic
def reject(claim: Claim, *, reason: str) -> Claim:
    claim = _lock(claim)
    if claim.status != ClaimStatus.SUBMITTED:
        raise ClaimRefused("Only a submitted claim can be rejected.")
    reason = reason.strip()
    if len(reason) < 10:
        raise ClaimRefused("Write the reason the insurer gave for rejecting the claim.")
    claim.status = ClaimStatus.REJECTED
    claim.decided_at = timezone.now()
    claim.decision_note = reason
    claim.save()
    return claim


@transaction.atomic
def settle(claim: Claim, *, amount_minor: int, reference: str) -> Claim:
    """Money received from the insurer, recorded as an insurer payment on the invoice.

    The remittance ``reference`` is required, so entering the same remittance twice changes
    nothing.
    """
    claim = _lock(claim)
    reference = reference.strip()
    if claim.status != ClaimStatus.APPROVED:
        raise ClaimRefused("Money can only be recorded against an approved claim.")
    if not reference:
        raise ClaimRefused("Enter the insurer payment reference.")
    key = f"claim:{claim.pk}:{reference}"
    if Payment.objects.filter(idempotency_key=key).exists():
        return claim
    if not 0 < amount_minor <= claim.outstanding_minor:
        raise ClaimRefused(
            f"The insurer owes {Money(claim.outstanding_minor, claim.currency)} on this claim."
        )
    services.record_payment(
        claim.invoice,
        payer=Payer.INSURER,
        method=PaymentMethod.INSURER_REMITTANCE,
        amount=Money(amount_minor, claim.currency),
        reference=reference,
        idempotency_key=key,
    )
    claim.received_minor += amount_minor
    if claim.received_minor >= (claim.approved_minor or 0):
        claim.status = ClaimStatus.PAID
        claim.settled_at = timezone.now()
    claim.save()
    return claim


AGEING_BANDS = (("0-30", 0, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("over 90", 91, None))


def ageing(now=None) -> list[dict]:
    """What insurers still owe, by how long ago the claim was sent."""
    now = now or timezone.now()
    bands = {
        name: {"band": name, "claims": 0, "outstanding_minor": 0} for name, _, _ in AGEING_BANDS
    }
    live = Claim.objects.filter(status__in=[ClaimStatus.SUBMITTED, ClaimStatus.APPROVED])
    for claim in live:
        days = (now - claim.submitted_at).days
        owed = (
            claim.outstanding_minor if claim.status == ClaimStatus.APPROVED else claim.claimed_minor
        )
        for name, low, high in AGEING_BANDS:
            if days >= low and (high is None or days <= high):
                bands[name]["claims"] += 1
                bands[name]["outstanding_minor"] += owed
                break
    return list(bands.values())
