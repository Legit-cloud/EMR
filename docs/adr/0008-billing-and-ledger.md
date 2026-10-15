# 8. Billing, payments and the double-entry ledger

Date: 2026-10-15
Status: Accepted (finance owner to confirm the posting rules and chart of accounts)

## Decision

**Charges.** Other modules call `billing.services.add_line` (pending), `finalise_line`
(delivered) or `charge_delivered` (both), and `void_line`, each idempotent on a key such
as `pharmacy.prescriptionitem:<id>`. A line goes to the patient's open (not Paid) invoice
in its currency. Amounts are integer minor units; `Money` is required.

**Insurer and patient split.** An invoice may have an insurer with coverage in basis
points (8 500 = 85%). Each line is split with `Money.allocate`, so the shares always add
up to the line (the odd kobo goes to the insurer share). Coverage is fixed once a charge
is final or a payment is made, because those are already in the ledger.

**Payments and status.** Payments are per payer (patient or insurer), never above what
that payer still owes, in the invoice currency, and idempotent on a client key (a retried
till or gateway call is recorded once). Status is derived: Unpaid, Partially Paid, Paid.
`invoice.paid` is published once when an invoice becomes Paid. Gateway settlement is out
of scope: method and reference are recorded as given.

**Ledger postings** (standard chart created per tenant on first use):

| Event | Debit | Credit |
| --- | --- | --- |
| Charge delivered (line final) | 1100 AR patients, 1110 AR insurers (shares) | 4xxx revenue by category |
| Payment received | 1000 Cash (cash) or 1010 Bank (card, transfer, remittance) | 1100 or 1110 |

CLAUDE.md asks for Debit Cash/Bank, Credit Accounts Receivable when an invoice is Paid.
Each payment is posted when it is received, so partial payments are in the cash
accounts the same day; once the invoice is Paid its whole receivable has moved to
Cash/Bank. Posting only at Paid would leave cash received on partly paid invoices out
of the books.

**Database guards.** A deferred constraint trigger refuses to commit any journal entry
whose debits and credits differ, and journal tables are append-only (corrections are
reversing entries). The application checks balance first too.

**Reconciliation.** `services.reconcile` and `manage.py reconcile_billing` check every
invoice (total, net due, status, splits) and the ledger (trial balance; revenue equals
final charges; cash and bank equal payments; receivable equals final charges minus
payments).

## Consequences

- Refunds, credit notes and write-offs are not built yet; void is for pending charges.
- A payment made before a charge is delivered leaves a credit in receivable until the
  charge becomes final; reconciliation accounts for it.
- Completed consultations bill the physician's fee through `appointment.completed`.
