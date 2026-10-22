# 18. Billing screen: invoice table, drawer, part payments and reminders

Date: 2026-10-21
Status: Accepted (pending finance review)

## Context

F12 replaces the first-release billing pages with the design-pack screen: a table of invoices
with payment pills, search, filters and a totals header, and an invoice drawer with charges,
who pays what, the totals, a payment dialog and "Send Reminder". The invoice API returned
whole invoices with no patient name, search, sorting, paging or totals, and had no reminder.

## Decision

**API (apps/billing).**
- `GET /api/billing/invoices/` is paginated (`page_size`), searchable (`q`: patient name, MRN,
  phone, or the start of the invoice number), sortable (`ordering`: created, total, due,
  status) and filterable (`payment_status`, `estate_review`, `patient`). Rows carry the
  invoice number (`INV-` plus the first eight characters of its id), the patient's name and
  MRN, and the number of live lines. The detail adds the lines and payments. Names come from
  `patients.selectors`, once per page; billing never queries patient tables.
- `GET /api/billing/invoices/summary/` returns counts by payment status and the money
  billed, collected and still due, in one currency, for the same `q`. It is scoped by the
  same policy as the list.
- `POST /api/billing/invoices/<id>/remind/` messages the patient about the balance: SMS to
  the phone and email to the address on file, through the queued notification path. It is
  refused (409 `reminder_refused`) when nothing is due, when the invoice is held for estate
  review or the patient has died, when the patient has no phone or email, and within
  `BILLING_REMINDER_INTERVAL_HOURS` (24) of the last one, which is stored on the invoice
  (`last_reminder_at`). It needs the same right as taking a payment (billing officer) and is
  audited as an update.

**Web app.**
- `/billing` is the table and header; the open invoice is `?invoice=<id>`, so links and the
  back button work. `/invoices/<id>` redirects there, and the chart and appointment drawer
  link to it.
- Money goes through `src/lib/money.ts` only: parsing, formatting, sums and splits use
  integers and BigInt, never floating point. `compactMoney` no longer divides in floats.
- A payment is any amount up to what the chosen payer still owes (the server enforces it);
  a smaller amount leaves the invoice Partially paid. The form keeps one idempotency key per
  opening, so a retry cannot record it twice.
- Each charge shows a source tag taken from its revenue category: Prescription (pharmacy),
  Lab, Imaging, Ward, and Service for consultations, procedures and the rest. Colours are in
  `status-map.ts`.
- The header's segmented bar counts invoices by payment status, and its colours match the
  pills.

## Consequences

- Reminders message a real person about money. The wording, the 24-hour interval and the
  rule that estate-review invoices never get one need sign-off from the finance owner.
- The category-to-tag mapping groups consultations and procedures as "Service"; finer tags
  need a source field per line, which the ledger does not record today.
- Export and print of the invoice list, a date filter and a separate Payments screen are not
  built; the drawer shows each invoice's payments.
- A new invoice list response shape: clients that read `lines` from the list must use the
  detail endpoint.
