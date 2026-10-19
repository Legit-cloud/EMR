# 11. Dashboard figures

Date: 2026-10-19
Status: Accepted

## Context

DESIGN.md Section 8 lays the dashboard out like the reference: cashflow, expenses, income
against expense, patients, popular services with ratings, and stock with "Order" links,
plus a clinical variant. The system records payments, charges (with a revenue category),
visits and stock, but no expenses, service ratings, lab results or purchase orders yet.
Earlier we agreed not to mock screens as if they worked.

## Decision

- A `reports` module serves `GET /api/reports/dashboard/?range=12m|30d`. It owns no tables;
  each figure comes from a selector in the module that owns the data (billing, scheduling,
  patients, pharmacy, clinical, staff). Figures are totals, never rows.
- A card is returned only when the user's role sees its data across the whole tenant
  (`policy.can_tenant_wide`). Scoped users would otherwise see totals that leak rows outside
  their scope or are silently incomplete. Clinicians get their own day instead: their queue
  and their unfinished notes and prescriptions.
- Where the reference needs data we do not have, the card shows what we do have:
  **Revenue by service** replaces Expenses, **Billed and collected** replaces Income and
  Expense, popular services show how often they were billed (no star ratings), and the stock
  card links to the formulary (no ordering yet). Results to review waits for diagnostics
  (Release 2).
- Low stock needs a threshold, so drugs gain `reorder_level` (default 20 units).
- Amounts are grouped by day or month in `REPORTING_TIME_ZONE` (Africa/Lagos) and counted
  in `REPORTING_CURRENCY` (NGN).

## Consequences

The expense cards return when accounting records expenses (Release 3), and "Order" links
when stock ordering exists (F13). Reorder levels should be set per drug by the pharmacy
before the stock card is relied on.
