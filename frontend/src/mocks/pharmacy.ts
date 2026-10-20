import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";
import { MIN_OVERRIDE_REASON } from "@/lib/prescribing";

import { CHART_PATIENT, chart, OPEN_VISIT } from "./chart";

/**
 * Prescribing, shaped like apps/pharmacy, with the rules the wizard relies on: only a draft can
 * be changed, the safety check can return blocking alerts, and signing needs a reason of at
 * least 15 characters for every blocking alert (409 safety_alerts otherwise). Synthetic data.
 */
const DOCTOR = "8a5e2f8c-0000-4000-8000-000000000010";

type Alert = Schemas["SafetyAlert"];
type Rx = Schemas["Prescription"];

const drug = (id: string, name: string, strength: string, form: string): Schemas["Drug"] =>
  ({
    id,
    name,
    brand_name: "",
    form,
    strength,
    ingredients: [name.toLowerCase()],
    classes: [],
    unit_price_minor: 10_000,
    currency: "NGN",
    on_formulary: true,
    reorder_level: 20,
  }) as Schemas["Drug"];

export const DRUGS = [
  drug("drug1", "Methyldopa", "250 mg", "tablet"),
  drug("drug2", "Amoxicillin", "500 mg", "capsule"),
  drug("drug3", "Ibuprofen", "400 mg", "tablet"),
  drug("drug4", "Warfarin", "5 mg", "tablet"),
];

export const BLOCKING: Alert = {
  kind: "allergy",
  key: "allergy:penicillin:drug2",
  severity: "severe",
  blocking: true,
  message: "Amoxicillin is a penicillin and the patient has a severe penicillin allergy.",
};

export const WARNING: Alert = {
  kind: "interaction",
  key: "interaction:drug3:drug4",
  severity: "moderate",
  blocking: false,
  message: "Ibuprofen with warfarin raises the risk of bleeding.",
};

type State = {
  prescriptions: Rx[];
  /** What the safety check returns for the next check or signing. */
  alerts: Alert[];
  calls: { path: string; body: unknown }[];
  next: number;
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function seeded(): Rx[] {
  return [
    {
      id: "rx1",
      patient: CHART_PATIENT,
      encounter: OPEN_VISIT,
      prescriber: DOCTOR,
      status: "authorised",
      note: "",
      items: [
        {
          id: "rxi1",
          drug: "drug1",
          drug_name: "Methyldopa 250 mg tablet",
          dose: "250 mg",
          frequency: "twice daily",
          route: "oral",
          duration_days: 30,
          quantity: 60,
          instructions: "",
          quantity_dispensed: 0,
        },
      ],
      alerts: [],
      authorised_at: hoursAgo(1),
      signing_key_id: "k1",
      signed_payload_sha256: "x",
      cancelled_reason: "",
      created_at: hoursAgo(1),
    },
  ];
}

export const pharmacy: State = { prescriptions: seeded(), alerts: [], calls: [], next: 1 };

export function resetPharmacyMocks(): void {
  Object.assign(pharmacy, { prescriptions: seeded(), alerts: [], calls: [], next: 1 });
}

const page = <T>(results: T[]) =>
  HttpResponse.json({ count: results.length, next: null, previous: null, results });

const failure = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

type ItemBody = Omit<Schemas["PrescriptionItemRequest"], never>;

function buildItems(rxId: string, items: ItemBody[]): Rx["items"] {
  return items.map((item, i) => ({
    ...item,
    id: `${rxId}-i${i}`,
    drug_name: (() => {
      const d = DRUGS.find((x) => x.id === item.drug)!;
      return `${d.name} ${d.strength} ${d.form}`;
    })(),
    quantity_dispensed: 0,
  })) as Rx["items"];
}

export const pharmacyHandlers = [
  http.get("*/api/pharmacy/drugs/", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    return page(DRUGS.filter((d) => d.name.toLowerCase().includes(q)));
  }),

  http.get("*/api/pharmacy/prescriptions/", () =>
    chart.forbidden.has("prescriptions")
      ? failure(403, "permission_denied", "You do not have permission.")
      : page(pharmacy.prescriptions),
  ),

  http.post("*/api/pharmacy/prescriptions/", async ({ request }) => {
    const body = (await request.json()) as { encounter: string; items: ItemBody[] };
    pharmacy.calls.push({ path: "create", body });
    const id = `rx-new-${pharmacy.next++}`;
    const row: Rx = {
      id,
      patient: CHART_PATIENT,
      encounter: body.encounter,
      prescriber: DOCTOR,
      status: "draft",
      note: "",
      items: buildItems(id, body.items),
      alerts: [],
      authorised_at: null,
      signing_key_id: "",
      signed_payload_sha256: "",
      cancelled_reason: "",
      created_at: new Date().toISOString(),
    };
    pharmacy.prescriptions.unshift(row);
    return HttpResponse.json(row, { status: 201 });
  }),

  http.patch("*/api/pharmacy/prescriptions/:id/", async ({ params, request }) => {
    const body = (await request.json()) as { items: ItemBody[] };
    pharmacy.calls.push({ path: `update/${String(params.id)}`, body });
    const row = pharmacy.prescriptions.find((p) => p.id === params.id)!;
    if (row.status !== "draft") {
      return failure(400, "validation_error", "A signed prescription cannot be changed.");
    }
    row.items = buildItems(row.id, body.items);
    return HttpResponse.json(row);
  }),

  http.post("*/api/pharmacy/prescriptions/:id/check/", ({ params }) => {
    pharmacy.calls.push({ path: `check/${String(params.id)}`, body: null });
    return HttpResponse.json(pharmacy.alerts);
  }),

  http.post("*/api/pharmacy/prescriptions/:id/authorise/", async ({ params, request }) => {
    const { overrides } = (await request.json()) as { overrides: Record<string, string> };
    pharmacy.calls.push({ path: `authorise/${String(params.id)}`, body: { overrides } });
    const row = pharmacy.prescriptions.find((p) => p.id === params.id)!;
    const missing = pharmacy.alerts.filter(
      (a) => a.blocking && (overrides[a.key] ?? "").trim().length < MIN_OVERRIDE_REASON,
    );
    if (missing.length > 0) {
      return failure(409, "safety_alerts", "Blocking safety alerts need an override reason.", {
        alerts: pharmacy.alerts,
        override_required: missing.map((a) => a.key),
      });
    }
    Object.assign(row, {
      status: "authorised",
      authorised_at: new Date().toISOString(),
      signing_key_id: "k1",
      signed_payload_sha256: "y",
      alerts: pharmacy.alerts.map((a) => ({
        ...a,
        override_reason: a.blocking ? overrides[a.key] : "",
      })),
    });
    return HttpResponse.json(row);
  }),

  http.post("*/api/pharmacy/prescriptions/:id/cancel/", async ({ params, request }) => {
    const body = (await request.json()) as { reason: string };
    pharmacy.calls.push({ path: `cancel/${String(params.id)}`, body });
    const row = pharmacy.prescriptions.find((p) => p.id === params.id)!;
    Object.assign(row, { status: "cancelled", cancelled_reason: body.reason });
    return HttpResponse.json(row);
  }),
];
