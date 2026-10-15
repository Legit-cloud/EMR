# 7. Prescribing safety checks, signatures and the pharmacy event chain

Date: 2026-10-15
Status: Accepted (clinical lead to confirm alert rules; interaction knowledge base pending)

## Decision

**Safety check before signing.** Authorising runs the checker named by
`PHARMACY_INTERACTION_CHECKER` against the new items and the patient's current
(authorised, undispensed) prescriptions:

- allergy: a recorded active allergy whose substance or code matches a drug ingredient
  or class -- always blocking;
- interaction: pairs from `InteractionRule`; major and contraindicated block, minor and
  moderate warn;
- duplicate therapy: the same ingredient twice -- warns.

A blocking alert needs an override reason of at least 15 characters. Without one the
request returns `409 safety_alerts` with every alert, and nothing is saved: no status
change, no alert rows, no signature, no event. With reasons, every alert is stored with
the prescription and each override is written to the audit log.

The starter `InteractionRule` rows are synthetic examples, not clinical advice. The real
knowledge base is an open decision; a licensed source plugs in as another checker class.

**Signatures (SEC-09).** Ed25519 over a canonical JSON payload: prescription, tenant,
patient, encounter, prescriber, authorisation time, every item and every override. The
payload is rebuilt from the database to verify, so any later change (quantity, dose,
time, override reason, or the signature itself) is detected. Dispensing refuses a
prescription whose signature does not verify, and signed items cannot be saved again.
`PRESCRIPTION_SIGNING_KEY` is required in production (no default);
`PRESCRIPTION_RETIRED_PUBLIC_KEYS` keeps older signatures verifiable after rotation.
This is a server (organisation) signature, not a personal e-signature of the prescriber;
per-prescriber keys belong with e-prescribing (Release 3). Dependency added:
`cryptography`, because the standard library has no asymmetric signatures.

**Event chain.** `prescription.authorised` -> reserve stock (earliest expiry first,
expired batches skipped; a shortage is logged, not fatal) and add one pending invoice line
per item through `billing.services` -> `prescription.dispensed` -> the line of each fully
dispensed item becomes final -> payment and ledger in Prompt 8. `prescription.cancelled`
releases stock and voids pending lines. Every handler is idempotent (billing lines use
an idempotency key), so a replayed event changes nothing. The prescriber's request only
commits and publishes; a slow or failing billing handler never delays or undoes it.

**Billing core.** A minimal `Invoice` and `InvoiceLine` exist now so the chain is real;
Prompt 8 adds payments, insurer and patient splits, and the ledger.

## Consequences

- Dispensing is its own policy action, so prescribers cannot dispense.
- Allergy matching is by ingredient and class names; coded matching improves once a
  terminology for substances is chosen.
