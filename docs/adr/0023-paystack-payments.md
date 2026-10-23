# 23. Paying a bill online with Paystack

Date: 2026-10-23
Status: Accepted (pending finance review of reconciliation and fees)

## Context

The owner chose Paystack as the payment gateway (CLAUDE.md Section 12, decision 9) and dropped SMS,
so everything the patient is told goes by email. The portal needs a way for a patient to pay part or
all of a bill. The risk to design around is a bill being marked paid when no money moved.

## Decision

**The bill is credited only after Paystack confirms it, exactly once.** Two things can confirm a
payment, and both go through one function, `billing.services.settle_online_payment`:
1. the signed webhook Paystack calls when a charge succeeds, and
2. the server asking Paystack (`verify`) when the patient comes back from the payment page.

A browser arriving back at the portal, a query string, or anything a client sends does not
change a bill. Staff cannot record a payment "by Paystack" by hand: the `online` payment method
is not accepted by the staff payment endpoint.

**Flow.**
1. The patient chooses an amount, up to what they owe of their own share, on one of their own bills.
   `POST /api/portal/invoices/{id}/pay/` creates a `PaymentIntent` with a random reference and asks
   Paystack to initialise a hosted checkout (amount in kobo, which is Paystack's unit too). The
   patient is sent to Paystack's page. The return address is built from the `PORTAL_URL` setting, never
   from the request. The bill is not touched.
2. The patient pays on Paystack's page. We never see or store card details.
3. Paystack calls `POST /api/billing/webhooks/paystack/`. The request is accepted only if its
   `x-paystack-signature` is the HMAC-SHA512 of the raw body made with our secret key (compared in
   constant time). Anything else is refused with 401 and written to the audit log. The tenant is taken
   from our own record of the reference.
4. `settle_online_payment` records the payment only if the reference is one we issued, Paystack says it
   succeeded, and the amount and currency equal what was asked. It uses `record_payment` with the key
   `paystack:<reference>`, so a webhook delivered twice, or a webhook plus a verify, records one payment
   and one ledger entry (Debit Bank, Credit Accounts Receivable).
5. Coming back, the portal calls `POST /api/portal/payments/{reference}/verify/`, which asks Paystack
   if the payment is still waiting, and tells the patient the outcome.

**When it cannot be applied.** If Paystack took money but the amount differs, or the bill has since been
paid another way, the intent is marked **flagged**, nothing is recorded, and billing officers and finance are
emailed. It shows in `GET /api/billing/payment-intents/?status=flagged`. A person decides whether to
refund it in the Paystack dashboard or apply it.

**Other rules.**
- Only the patient's own share is payable online, never the insurer's. Only naira bills. Not a bill held
  for estate review or belonging to a deceased patient.
- One open payment per bill at a time (30 minutes, `PAYMENT_INTENT_MINUTES`): a patient who closes the tab and
  tries again for the same amount is sent back to the same page, and a different amount has to wait. This keeps
  two payments from overpaying a bill.
- The gateway is called outside the database transaction, so a slow Paystack never holds a lock.
- The adapter uses the standard library's HTTP client, so no dependency was added. Tests use a fake
  gateway; nothing in the test suite touches the network.
- Without `PAYSTACK_SECRET_KEY` the portal says online payment is not available and nothing else changes.

## Consequences

- **One Paystack account for the whole platform for now.** Money lands in one settlement account. A SaaS
  with many hospitals will need a Paystack sub-account (split) or a key per tenant so each hospital is paid
  directly; that is a larger decision with a finance and legal owner.
- **Fees.** Paystack deducts its fee when it settles. The ledger records the gross payment against the
  bill. The fee and the settlement bank deposit need a reconciliation entry at settlement time, which is
  not built (`docs/signoff/finance.md`).
- **Refunds** are done in the Paystack dashboard and recorded by finance; the system's rule that refunds are
  separate still holds. There is no refund screen.
- **Partial payment and abandoned checkouts** leave pending intents. They are harmless: a pending intent
  never changes a bill. They are not cleaned up.
- Receipts are Paystack's own email. A hospital receipt is not generated yet.
- The webhook relies on Paystack's retries if our server is down. Finance should still reconcile the
  Paystack transaction list against the system daily (`docs/runbooks/paystack.md`).
