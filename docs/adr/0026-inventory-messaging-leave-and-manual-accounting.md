# 26. Inventory, staff messaging, leave and manual accounting

Date: 2026-11-20
Status: Accepted (pending finance and HR review)

## Context

The outstanding Release 2 and Release 3 items that need no external decision: general
inventory beyond pharmacy stock, internal messaging, HR (leave) and accounting beyond what
invoices post. E-prescribing, external lab and PACS integration, and HMO partner specifics
wait on the open decisions in CLAUDE.md Section 12.

## Decision

**Inventory (`apps/inventory`).** `Item` (SKU unique per tenant, unit, reorder level, unit
cost in minor units) and append-only `StockMovement` (receive, issue, count correction, with
the running balance). `Item.on_hand` is changed only in `services`, under a row lock, in
the same transaction as the movement, and never below zero. A count correction needs a
reason. Drugs stay in pharmacy; this is for supplies. Pharmacists and the tenant admin
maintain items; nurses issue; pharmacists receive and correct; the tenant admin only looks.

**Messaging (`apps/messaging`).** Staff-to-staff threads. Membership, not role, decides who
can read a thread: not even the tenant admin sees other people's threads. Recipients must be
active staff of the same tenant. The notification email says a message is waiting and never
repeats its text. Messages are not part of the clinical record and are never edited.

**Leave (`apps/staff`).** `LeaveRequest` for the person asking, decided by HR. No past
dates, no overlap with pending or approved leave, a reason is needed to reject, a decision is
final, and nobody decides their own request. The requester is emailed the decision.

**Manual accounting (`apps/billing`).** Finance can post balanced manual entries (expenses,
supplier bills, opening balances) and reverse them; entries are never edited. The chart gains
accounts payable, equity and expense accounts. Only manual entries can be reversed here;
invoice entries are corrected on the invoice. New reports: income statement for a period and
balance sheet as at a date, where profit to date is shown in equity so assets equal
liabilities plus equity. `reconcile` ignores manual and reversal entries when comparing the
ledger with invoices and payments; the trial balance still covers every entry.

## Consequences

- No screens yet: the API and OpenAPI schema are ready; the web app has no pages for these.
- Inventory does not post to the ledger, and issued supplies are not billed to patients.
- Messaging has no attachments, no live push over WebSockets, and no patient access.
- Leave has no entitlement balances or public-holiday calendar.
- No supplier bill tracking, tax or fixed-asset accounting. Finance must review the chart of
  accounts and the manual-entry rules before use.
