import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";
import { allocate, formatMoney, sumMinor } from "@/lib/money";

import { mockSignedIn } from "./auth";
import { chart } from "./chart";

/**
 * Invoices, shaped like apps/billing, with the rules the screen relies on: a payment cannot
 * exceed what its payer still owes, coverage is fixed once a charge is delivered or money is
 * received, and a reminder is refused for a paid or estate-review invoice, a patient with no
 * contact details, or a second one within a day. Synthetic data; all money is integer kobo.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Invoice = Omit<Mutable<Schemas["Invoice"]>, "lines" | "payments"> & {
  lines: Mutable<Schemas["InvoiceLine"]>[];
  payments: Mutable<Schemas["Payment"]>[];
};
type Entry = { invoice: Invoice; reachable: boolean };

export const HMO = { id: "9a5e2f8c-0000-4000-8000-0000000007f1", name: "Synthetic HMO" };
const HMO_CODE = "synth-hmo";

export const INV_UNPAID = "1a5e2f8c-0000-4000-8000-000000000701";
export const INV_PART = "2a5e2f8c-0000-4000-8000-000000000702";
export const INV_PAID = "3a5e2f8c-0000-4000-8000-000000000703";
export const INV_INSURED = "4a5e2f8c-0000-4000-8000-000000000704";
export const INV_LOCKED = "5a5e2f8c-0000-4000-8000-000000000705";
export const INV_ESTATE = "6a5e2f8c-0000-4000-8000-000000000706";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

type State = {
  entries: Entry[];
  /** Requests received, for assertions. */
  calls: { path: string; body: unknown }[];
  next: number;
};

let counter = 0;
const line = (
  description: string,
  revenue_category: Schemas["RevenueCategoryEnum"],
  quantity: number,
  unit: number,
  status: Schemas["InvoiceLineStatusEnum"] = "final",
): Invoice["lines"][number] => ({
  id: `line-${++counter}`,
  source: "test.source",
  source_id: String(counter),
  description,
  revenue_category,
  quantity,
  unit_price_minor: unit,
  amount_minor: unit * quantity,
  insurer_amount_minor: 0,
  patient_amount_minor: unit * quantity,
  status,
  finalised_at: status === "final" ? hoursAgo(5) : null,
});

const payment = (
  invoice: string,
  amount: number,
  payer: Schemas["PayerEnum"] = "patient",
  method: Schemas["PaymentMethodEnum"] = "cash",
  reference = "",
): Invoice["payments"][number] => ({
  id: `pay-${++counter}`,
  invoice,
  payer,
  method,
  amount_minor: amount,
  currency: "NGN",
  reference,
  received_at: hoursAgo(3),
  received_by: null,
});

function build(
  id: string,
  who: [name: string, mrn: string],
  hours: number,
  lines: Invoice["lines"],
  options: {
    insurer?: boolean;
    coverageBp?: number;
    payments?: Invoice["payments"];
    estate?: boolean;
    reachable?: boolean;
  } = {},
): Entry {
  const invoice: Invoice = {
    id,
    reference: `INV-${id.slice(0, 8).toUpperCase()}`,
    patient: `patient-${id.slice(0, 1)}`,
    patient_name: who[0],
    patient_mrn: who[1],
    currency: "NGN",
    insurer: options.insurer ? HMO.id : null,
    insurer_coverage_bp: options.coverageBp ?? 0,
    payment_status: "unpaid",
    total_minor: 0,
    insurer_due_minor: 0,
    patient_due_minor: 0,
    insurer_paid_minor: 0,
    patient_paid_minor: 0,
    net_due_minor: 0,
    paid_at: null,
    estate_review: options.estate ?? false,
    last_reminder_at: null,
    lines,
    payments: options.payments ?? [],
    created_at: hoursAgo(hours),
  };
  recalculate(invoice);
  return { invoice, reachable: options.reachable ?? true };
}

/** The same rules as billing.services.recalculate, in integer arithmetic. */
function recalculate(invoice: Invoice): void {
  const live = invoice.lines.filter((l) => l.status !== "void");
  for (const l of live) {
    const [insurer, patient] = invoice.insurer_coverage_bp
      ? allocate(l.amount_minor, [
          invoice.insurer_coverage_bp,
          10_000 - invoice.insurer_coverage_bp,
        ])
      : [0, l.amount_minor];
    l.insurer_amount_minor = insurer;
    l.patient_amount_minor = patient;
  }
  const paidBy = (payer: string) =>
    sumMinor(invoice.payments.filter((p) => p.payer === payer).map((p) => p.amount_minor));
  invoice.total_minor = sumMinor(live.map((l) => l.amount_minor));
  invoice.insurer_due_minor = sumMinor(live.map((l) => l.insurer_amount_minor ?? 0));
  invoice.patient_due_minor = sumMinor(live.map((l) => l.patient_amount_minor ?? 0));
  invoice.insurer_paid_minor = paidBy("insurer");
  invoice.patient_paid_minor = paidBy("patient");
  const paid = invoice.insurer_paid_minor + invoice.patient_paid_minor;
  invoice.net_due_minor = invoice.total_minor - paid;
  invoice.payment_status =
    paid === 0 ? "unpaid" : invoice.net_due_minor > 0 ? "partially_paid" : "paid";
  invoice.paid_at = invoice.payment_status === "paid" ? (invoice.paid_at ?? hoursAgo(0)) : null;
}

function seeded(): Entry[] {
  return [
    build(INV_UNPAID, ["Tolu Okafor", "MRN-2026-0101"], 2, [
      line("Consultation", "consultation", 1, 500_000),
      line("Paracetamol 500 mg", "pharmacy", 2, 265_000, "pending"),
    ]),
    build(
      INV_PART,
      ["Bisi Lawal", "MRN-2026-0102"],
      30,
      [
        line("Consultation", "consultation", 1, 500_000),
        line("Malaria test", "laboratory", 1, 300_000),
      ],
      { payments: [payment(INV_PART, 500_000, "patient", "cash", "POS-1")], reachable: false },
    ),
    build(
      INV_PAID,
      ["Chidi Nwosu", "MRN-2026-0103"],
      50,
      [line("Consultation", "consultation", 1, 500_000)],
      { payments: [payment(INV_PAID, 500_000)] },
    ),
    build(
      INV_INSURED,
      ["Ngozi Eze", "MRN-2026-0104"],
      70,
      [line("Chest X-ray", "imaging", 1, 2_000_000, "pending")],
      { insurer: true, coverageBp: 8_000 },
    ),
    build(
      INV_LOCKED,
      ["Amina Bello", "MRN-2026-0105"],
      90,
      [line("Ward bed, day 1", "ward", 1, 4_000_000)],
      {
        insurer: true,
        coverageBp: 5_000,
        payments: [payment(INV_LOCKED, 1_000_000, "insurer", "insurer_remittance", "REM-9")],
      },
    ),
    build(
      INV_ESTATE,
      ["Ife Adeyemi", "MRN-2026-0106"],
      110,
      [line("Consultation", "consultation", 1, 500_000)],
      { estate: true },
    ),
  ];
}

export const billing: State = { entries: seeded(), calls: [], next: 1 };

export function resetBillingMocks(): void {
  counter = 100;
  Object.assign(billing, { entries: seeded(), calls: [], next: 1 });
}

export const entryOf = (id: string) => billing.entries.find((e) => e.invoice.id === id);

// -- handlers ---------------------------------------------------------------------------------

const failure = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const VIEWERS = ["billing_officer", "finance", "front_desk", "tenant_admin"];

/** 401, 403 or null when the signed-in user may view (or, with `write`, change) invoices. */
function refusal(write = false) {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  const allowed = write ? ["billing_officer"] : VIEWERS;
  return me.roles.some((r) => allowed.includes(r))
    ? null
    : failure(403, "permission_denied", "You do not have permission.");
}

function row(invoice: Invoice): Schemas["InvoiceList"] {
  return {
    id: invoice.id,
    reference: invoice.reference,
    patient: invoice.patient,
    patient_name: invoice.patient_name,
    patient_mrn: invoice.patient_mrn,
    currency: invoice.currency,
    insurer: invoice.insurer,
    payment_status: invoice.payment_status,
    total_minor: invoice.total_minor,
    net_due_minor: invoice.net_due_minor,
    paid_at: invoice.paid_at,
    estate_review: invoice.estate_review,
    line_count: invoice.lines.filter((l) => l.status !== "void").length,
    last_reminder_at: invoice.last_reminder_at,
    created_at: invoice.created_at,
  };
}

function matching(url: URL): Invoice[] {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().replace(/^#/, "");
  const status = url.searchParams.get("payment_status");
  const patient = url.searchParams.get("patient");
  return billing.entries
    .map((e) => e.invoice)
    .filter(
      (i) =>
        (!q ||
          i.patient_name.toLowerCase().includes(q) ||
          i.patient_mrn.toLowerCase().includes(q) ||
          i.reference.toLowerCase().includes(q)) &&
        (!status || i.payment_status === status) &&
        (!patient || i.patient === patient) &&
        (url.searchParams.get("estate_review") !== "true" || i.estate_review),
    );
}

const ORDER = {
  created: "created_at",
  total: "total_minor",
  due: "net_due_minor",
  status: "payment_status",
} as const;

function ordered(invoices: Invoice[], ordering: string | null): Invoice[] {
  const raw = ordering ?? "-created";
  const key = ORDER[raw.replace(/^-/, "") as keyof typeof ORDER] ?? "created_at";
  const sign = raw.startsWith("-") ? -1 : 1;
  return [...invoices].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

const oneDay = 24 * 3_600_000;

export const billingHandlers = [
  http.get("*/api/billing/invoices/summary/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const found = matching(new URL(request.url));
    const count = (status: string) => found.filter((i) => i.payment_status === status).length;
    return HttpResponse.json({
      currency: "NGN",
      unpaid_count: count("unpaid"),
      partially_paid_count: count("partially_paid"),
      paid_count: count("paid"),
      billed_minor: sumMinor(found.map((i) => i.total_minor)),
      collected_minor: sumMinor(found.map((i) => i.insurer_paid_minor + i.patient_paid_minor)),
      outstanding_minor: sumMinor(found.map((i) => i.net_due_minor)),
    } satisfies Schemas["InvoiceSummary"]);
  }),

  http.get("*/api/billing/invoices/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    // The patient chart's Billing tab reads the same list.
    if (chart.forbidden.has("invoices")) {
      return failure(403, "permission_denied", "You do not have permission.");
    }
    const url = new URL(request.url);
    const all = ordered(matching(url), url.searchParams.get("ordering"));
    const size = Number(url.searchParams.get("page_size") ?? 25);
    const page = Number(url.searchParams.get("page") ?? 1);
    const results = all.slice((page - 1) * size, page * size).map(row);
    return HttpResponse.json({ count: all.length, next: null, previous: null, results });
  }),

  http.get("*/api/billing/invoices/:id/", ({ params }) => {
    const refused = refusal();
    if (refused) return refused;
    const entry = entryOf(String(params.id));
    return entry ? HttpResponse.json(entry.invoice) : failure(404, "not_found", "Not found.");
  }),

  http.get("*/api/billing/insurers/", () => {
    const refused = refusal();
    if (refused) return refused;
    const insurer: Schemas["Insurer"] = {
      id: HMO.id,
      name: HMO.name,
      code: HMO_CODE,
      is_active: true,
    };
    return HttpResponse.json({ count: 1, next: null, previous: null, results: [insurer] });
  }),

  http.post("*/api/billing/invoices/:id/pay/", async ({ params, request }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const entry = entryOf(String(params.id));
    if (!entry) return failure(404, "not_found", "Not found.");
    const { invoice } = entry;
    const body = (await request.json()) as Schemas["PaymentRequestRequest"];
    billing.calls.push({ path: "pay", body });
    const seen = invoice.payments.find((p) => p.reference === `key:${body.idempotency_key}`);
    if (seen) return HttpResponse.json(seen, { status: 201 });
    if (body.payer === "insurer" && !invoice.insurer) {
      return failure(409, "payment_refused", "This invoice has no insurer.");
    }
    if ((body.method === "insurer_remittance") !== (body.payer === "insurer")) {
      return failure(409, "payment_refused", "Insurer remittance is only for insurer payments.");
    }
    const owed =
      body.payer === "insurer"
        ? invoice.insurer_due_minor - invoice.insurer_paid_minor
        : invoice.patient_due_minor - invoice.patient_paid_minor;
    if (body.amount_minor > owed) {
      return failure(
        409,
        "payment_refused",
        `The ${body.payer} owes ${formatMoney(Math.max(owed, 0), "NGN")}; refunds are separate.`,
      );
    }
    const made = payment(invoice.id, body.amount_minor, body.payer, body.method, body.reference);
    invoice.payments.push(made);
    recalculate(invoice);
    return HttpResponse.json(made, { status: 201 });
  }),

  http.post("*/api/billing/invoices/:id/coverage/", async ({ params, request }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const entry = entryOf(String(params.id));
    if (!entry) return failure(404, "not_found", "Not found.");
    const { invoice } = entry;
    const body = (await request.json()) as Schemas["CoverageRequest"];
    billing.calls.push({ path: "coverage", body });
    if (invoice.payments.length > 0 || invoice.lines.some((l) => l.status === "final")) {
      return failure(
        409,
        "billing_locked",
        "Coverage is fixed once a charge is final or a payment is made.",
      );
    }
    invoice.insurer = body.insurer ?? null;
    invoice.insurer_coverage_bp = body.coverage_bp;
    recalculate(invoice);
    return HttpResponse.json(invoice);
  }),

  http.post("*/api/billing/invoices/:id/charge/", async ({ params, request }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const entry = entryOf(String(params.id));
    if (!entry) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as Schemas["ManualChargeRequest"];
    billing.calls.push({ path: "charge", body });
    const added = line(
      body.description,
      body.revenue_category,
      body.quantity,
      body.unit_price_minor,
      body.delivered === false ? "pending" : "final",
    );
    entry.invoice.lines.push(added);
    recalculate(entry.invoice);
    return HttpResponse.json(added, { status: 201 });
  }),

  http.post("*/api/billing/invoices/:id/remind/", ({ params }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const entry = entryOf(String(params.id));
    if (!entry) return failure(404, "not_found", "Not found.");
    const { invoice } = entry;
    billing.calls.push({ path: "remind", body: null });
    const refuse = (message: string) => failure(409, "reminder_refused", message);
    if (invoice.payment_status === "paid") return refuse("Nothing is due on this invoice.");
    if (invoice.estate_review) {
      return refuse("This invoice is held for estate review. Do not send a reminder.");
    }
    if (!entry.reachable) return refuse("The patient has no phone number or email on file.");
    if (invoice.last_reminder_at && Date.now() - Date.parse(invoice.last_reminder_at) < oneDay) {
      return refuse("A reminder was sent recently. Wait 24 hours between reminders.");
    }
    invoice.last_reminder_at = new Date().toISOString();
    return HttpResponse.json({
      channels: ["sms", "email"],
      last_reminder_at: invoice.last_reminder_at,
    });
  }),
];
