import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

/** Ledger entries and reports, shaped like apps/billing (docs/adr/0026). Synthetic data. */
type Entry = Schemas["JournalEntry"];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function seeded(): Mutable<Entry>[] {
  return [
    {
      id: "entry-1",
      posted_at: new Date().toISOString(),
      description: "Consultation delivered",
      source: "invoice",
      source_id: "inv-1",
      currency: "NGN",
      lines: [
        { account: "1100", debit_minor: 1_000_000, credit_minor: 0 },
        { account: "4100", debit_minor: 0, credit_minor: 1_000_000 },
      ],
    },
  ];
}

export let entries = seeded();
export const resetAccountingMocks = () => {
  entries = seeded();
};

const refuse = (message: string) =>
  HttpResponse.json(
    { error: { code: "manual_entry_refused", message, details: {} } },
    { status: 400 },
  );

export const accountingHandlers = [
  http.get("*/api/billing/ledger/entries/", () =>
    HttpResponse.json({ count: entries.length, next: null, previous: null, results: entries }),
  ),
  http.post("*/api/billing/ledger/entries/", async ({ request }) => {
    const body = (await request.json()) as Schemas["ManualEntryRequest"];
    const debit = body.lines.reduce((s, l) => s + (l.debit_minor ?? 0), 0);
    const credit = body.lines.reduce((s, l) => s + (l.credit_minor ?? 0), 0);
    if (debit !== credit) return refuse("Debits do not equal credits.");
    const entry: Mutable<Entry> = {
      id: `entry-${entries.length + 1}`,
      posted_at: new Date().toISOString(),
      description: body.description,
      source: "manual",
      source_id: "manual",
      currency: body.currency,
      lines: body.lines.map((l) => ({
        account: l.account,
        debit_minor: l.debit_minor ?? 0,
        credit_minor: l.credit_minor ?? 0,
      })),
    };
    entries.push(entry);
    return HttpResponse.json(entry, { status: 201 });
  }),
  http.post("*/api/billing/ledger/entries/:id/reverse/", async ({ params, request }) => {
    const body = (await request.json()) as Schemas["ReverseEntryRequest"];
    const entry = entries.find((e) => e.id === params.id);
    if (!entry) return HttpResponse.json({}, { status: 404 });
    if (entry.source !== "manual") return refuse("Only manual entries can be reversed here.");
    const reversal: Mutable<Entry> = {
      ...entry,
      id: `entry-${entries.length + 1}`,
      description: `Reversal: ${entry.description} (${body.reason})`,
      source: "reversal",
      lines: entry.lines.map((l) => ({
        account: l.account,
        debit_minor: l.credit_minor ?? 0,
        credit_minor: l.debit_minor ?? 0,
      })),
    };
    entries.push(reversal);
    return HttpResponse.json(reversal, { status: 201 });
  }),
  http.get("*/api/billing/ledger/accounts/income-statement/", ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json({
      start: url.searchParams.get("start") ?? "2026-11-01",
      end: url.searchParams.get("end") ?? "2026-11-30",
      currency: "NGN",
      revenue: [{ code: "4100", name: "Revenue - consultations", amount_minor: 1_000_000 }],
      expenses: [{ code: "5300", name: "Utilities and rent", amount_minor: 300_000 }],
      total_revenue_minor: 1_000_000,
      total_expenses_minor: 300_000,
      net_minor: 700_000,
    });
  }),
  http.get("*/api/billing/ledger/accounts/balance-sheet/", ({ request }) =>
    HttpResponse.json({
      as_of: new URL(request.url).searchParams.get("as_of") ?? "2026-11-30",
      currency: "NGN",
      assets: [{ code: "1000", name: "Cash on hand", amount_minor: 700_000 }],
      liabilities: [],
      equity: [{ code: "3000", name: "Owner's equity", amount_minor: 0 }],
      profit_to_date_minor: 700_000,
      total_assets_minor: 700_000,
      total_liabilities_minor: 0,
      total_equity_minor: 700_000,
    }),
  ),
];
