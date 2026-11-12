# Finance sign-off

Reviewer: the finance owner, named here: ____________________

Money is stored as whole minor units (kobo) with a currency, never as decimals. Recommendations
below are common hospital finance practice; confirm each against your accountant.

## 1. Bed-day billing (applied)

**Recommendation.** Charge a ward day at midnight for each night occupied. On discharge, the day of
discharge is **not** charged, unless the patient was admitted and discharged the same day (then one
day is charged). The discharge-day line, already posted at 00:00, is voided, not deleted, so the
history shows it.

**System.** Done (ADR 0021 amendment). **Confirm:** the rule, and the rate card by ward.

- [ ] Approved  Signed: ____________  Date: ________

## 2. Payment reminders (applied)

**Recommendation.** Email only; remind for the patient's own share (not the insurer's); at most
3 reminders, at least 72 hours apart; stop if the patient asked not to be reminded or has no email.
After the third, escalate to a person.

**System.** Done, settings `BILLING_REMINDER_MAX` and `BILLING_REMINDER_INTERVAL_HOURS`.
**Confirm:** the numbers and who handles escalations.

- [ ] Approved  Signed: ____________  Date: ________

## 3. Paystack operation

**Recommendation.**
1. Card and transfer payments credit the bill only after Paystack confirms the amount and currency
   (done). A payment that does not match is flagged and the billing team is emailed (done); they
   decide, the system never guesses.
2. Reconcile daily: compare Paystack's settlement report to the payments recorded online. The
   difference should be zero apart from Paystack's fee and the settlement delay (next working day is
   typical; check your agreement).
3. Record Paystack's fee as an expense when settled, not against the patient's bill.
4. Use separate test and live keys; only the live key in production; rotate it if anyone who held it
   leaves. Keys live in environment variables only.
5. Set the webhook URL in the Paystack dashboard to `/api/billing/webhooks/paystack/` on the live site.

**System.** 1 done. 2 to 5 are procedures; see `docs/runbooks/paystack.md`. Fee accounting is not built.
**Confirm:** who reconciles, and the fee treatment.

- [ ] Approved  Signed: ____________  Date: ________

## 4. Refunds and reversals

**Recommendation.** Refunds are initiated from the Paystack dashboard by a finance officer, approved by a
second person above a threshold you set, and recorded as a reversing entry with the reason. Never edit or
delete a posted payment.

**System.** Not built: refunds are manual outside the system. Posted entries cannot be edited.
**Confirm:** the approval threshold.

- [ ] Approved  Signed: ____________  Date: ________

## 5. Discounts, waivers and write-offs

**Recommendation.** Each needs a reason and a named approver, separate from the person who raised the
bill. Report them monthly.

**System.** Not built. **Confirm:** approval levels.

- [ ] Approved  Signed: ____________  Date: ________

## 6. Deposits and prepayments

**Recommendation.** Take a deposit for admissions as a liability (money owed back to the patient), not
income, until it is applied to a bill.

**System.** Not built. **Confirm:** whether you take deposits.

- [ ] Approved  Signed: ____________  Date: ________

## 7. Purchase orders

**Recommendation.** The person who raises an order does not approve it, and nobody receives stock they
ordered. Quote the order number on the delivery note and the invoice (the order email now says so).

**System.** Email wording done; separation of duties follows roles. **Confirm:** approval limits.

- [ ] Approved  Signed: ____________  Date: ________

## 8. Tax

**Recommendation.** Most health services are exempt or zero-rated for VAT in Nigeria but some goods
and services are not. Ask a tax adviser before go-live which lines carry tax, and how it is shown on
invoices. No tax is calculated today.

- [ ] Reviewed with tax adviser  Signed: ____________  Date: ________

## 9. Controls to keep

Posted entries are never changed; every payment has a reference; a paid invoice creates a balanced
entry (debit bank, credit receivables); the same payment cannot be recorded twice. Review the failed
and flagged payments list weekly.

## 10. Insurer claims (built, ADR 0025)

**Recommendation.** Send each claim within the insurer's filing window (check each HMO agreement;
commonly 30 to 60 days from discharge). Chase anything over 60 days. When an insurer approves less than
claimed, decide in writing who bears the difference: the patient (if the plan says so), or the hospital
as a discount, approved by a second person. Write off a rejected claim only after the appeal period,
with a reason and an approver.

**System.** Claims are made from an invoice, sent, answered (approved in full or part, or rejected with a
reason) and paid as money arrives, each remittance entered once by its reference. The ageing report and
dashboard card show what insurers owe. **Not built:** moving a shortfall to the patient, write-offs,
electronic submission. **Confirm:** the filing window per insurer, shortfall policy, write-off approval.

- [ ] Approved  Signed: ____________  Date: ________

## Not verified by software

Finance logic needs a human review before release (CLAUDE.md Section 8): reconciliation against real
settlement files, and the ledger against your chart of accounts.
