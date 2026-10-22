# 19. Pharmacy stock screen, vendors and purchase orders

Date: 2026-10-21
Status: Accepted (pending pharmacy and finance review)

## Context

F13 adds `/pharmacy/stock`: a header with the stock value and the in-stock, low and out
counts, an Inventory tab, and an Order Stock tab with a wizard to order and a dialog to
receive. The pharmacy module had drugs, batches and prescriptions, but no vendors, no orders
and no way to receive a delivery against an order, so the backend grew with the screen.

## Decision

**Models (apps/pharmacy).**
- `Vendor`: name (unique per tenant), email, phone, active.
- `PurchaseOrder`: vendor, status (`pending`, `partially_received`, `complete`, `cancelled`),
  currency, note, `email_sent_at`. Its number is `PO-` plus the first eight characters of its
  id. Status is stored and always recomputed from the lines inside the receiving transaction.
- `PurchaseOrderLine`: drug, quantity ordered and received, unit cost in minor units. A
  database check keeps received at or under ordered.
- `OrderReceipt`: one delivery against one line (quantity, batch number, expiry), kept as the
  history of what arrived when and who booked it.

**Rules (services).**
- Placing an order needs an active vendor and at least one item, each formulary drug once,
  in one currency. If the vendor has an email address the order is queued as an email
  (`notifications.queue_email`) and `email_sent_at` is set; without one the order is still
  placed and the screen says it was not emailed.
- Receiving locks the order and its lines, and is all or nothing. Each line takes up to what
  is still expected, a batch number and a future expiry date. The units join stock as a batch:
  an existing batch of the same drug and number is topped up (its expiry must match),
  otherwise a new batch is created. The order is then Partially received until every line has
  arrived, and Complete after.
- Only an order with nothing received can be cancelled. The vendor is not told; the screen
  says so.

**API.** `GET stock/summary/` (value, product count, in/low/out, items to reorder),
`GET stock/inventory/` (per drug: available, on order, status, value; search, status filter,
paging), `vendors/`, and `orders/` with `place`, `receive` and `cancel` actions. Pharmacists
do everything. The tenant admin views everything (ADR 0010); finance views vendors and orders
only, not stock levels. Everything is audited.

**Web app.** The tab and an "order this drug" shortcut live in the address (`?tab=`,
`?order=<drug>`), so the dashboard's low-stock rows and the inventory table's Order links open
the wizard on that drug. Money uses `src/lib/money.ts` and integer arithmetic only.

## Consequences

- The cost per unit is typed by the pharmacist; the formulary only stores a selling price.
  A last-paid cost per drug would save typing and is not built.
- There is no order detail screen yet. The table shows progress; the receipt history is in
  the API (`receipts` on an order) and not on screen.
- Vendor invoices, returns, and ledger entries for stock purchases are out of scope. Buying
  stock does not touch the accounting ledger.
- A vendor who is emailed an order gets plain text only. The wording needs sign-off from the
  pharmacy lead, and a vendor's real email address should never be used in demo data.
- The older formulary page still receives stock directly, without an order. Both routes end in
  the same batches.
