# Runbook: Paystack payments

How online payment is switched on, tested, reconciled and rolled back. Design: `docs/adr/0023`.

## Switch it on (staging first, with test keys)

1. In the Paystack dashboard use **Test mode** and copy the **test secret key** (`sk_test_...`).
2. Set these in the environment (Railway variables per environment, never in Git or the image):
   - `PAYSTACK_SECRET_KEY` — the secret key for that environment.
   - `PORTAL_URL` — the public web address, for example `https://staging.example.com`. Paystack sends the
     patient back to `<PORTAL_URL>/portal/invoices`, and reminder emails link there.
   - `PAYMENT_INTENT_MINUTES` (default 30) if you want a different wait before a new payment can start.
3. In the Paystack dashboard, **Settings, API Keys & Webhooks**, set the **webhook URL** to
   `<PORTAL_URL>/api/billing/webhooks/paystack/` (the test webhook URL in test mode, the live one in live mode).
4. Restart the web and worker services so they read the key.

Without `PAYSTACK_SECRET_KEY`, the portal says online payment is not available and the webhook refuses
everything. That is the safe default.

## Test it (test mode)

1. Invite a test patient to the portal, with an email address, and give them a bill.
2. Sign in as the patient, open Invoices, press **Pay now**, enter an amount, and continue.
3. On Paystack's page use one of Paystack's documented test cards; complete the payment.
4. Back on the portal, the page should say "Payment received" and the bill should drop by that amount.
5. In Paystack's dashboard the webhook log should show a delivery that returned 200.
6. Try: close the tab before paying and press Pay again (you return to the same page); pay twice for the
   same bill (the second must wait or be limited to what is still owed); and cancel on Paystack's page
   (the portal must say it has not been told of a payment, and the bill must not change).

## Go live

- Paystack needs the business verified before live keys work. Do that first.
- Switch the environment to the **live** secret key and the live webhook URL. Keep test keys on staging.
- Make one small real payment, confirm it appears on the bill, in the ledger, and in Paystack, then refund
  it from the dashboard and record the refund.
- Confirm who receives the "payment needs review" emails: every user with the Billing officer or Finance role.

## Every day (finance)

- Compare Paystack's transaction list for the day with `GET /api/billing/payment-intents/` and the
  payments on the bills. Every successful Paystack transaction must have a recorded payment.
- Look at `GET /api/billing/payment-intents/?status=flagged`. Each one is money Paystack took that the
  system could not apply: refund it in the dashboard, or apply it to the right bill by hand, then write
  down what was done.
- Reconcile Paystack's settlement deposits (net of fees) to the bank statement.

## When something goes wrong

| Sign | Likely cause | What to do |
| --- | --- | --- |
| Patient paid, bill unchanged | webhook not delivered and the patient did not return | Open the portal payment return URL again, or check the intent; Paystack retries the webhook; if it stays pending, record the payment by hand with the Paystack reference and tell finance |
| Webhook returns 401 in the Paystack log | wrong secret key for that environment, or a proxy changed the body | Check `PAYSTACK_SECRET_KEY` matches the dashboard mode; the signature covers the raw body |
| "Online payment is not available yet" | no key set | Set `PAYSTACK_SECRET_KEY` and restart |
| "The payment service could not be reached" | Paystack outage or network | Nothing is recorded; patients can pay at the cashier; retry later |
| Flagged payment | amount differed or the bill was settled another way | See "Every day" |

## Roll back

Remove `PAYSTACK_SECRET_KEY` and restart. Online payment switches off; existing payments stay; patients
pay at the cashier or by transfer. The Pay button shows an error rather than failing silently.
