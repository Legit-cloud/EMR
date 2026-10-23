import { http, HttpResponse } from "msw";

import type { DiagnosticOrder, DiagnosticResult, Investigation } from "@/lib/diagnostics";

import { mockSignedIn } from "./auth";

/**
 * Laboratory and imaging as apps/diagnostics serves them. A result is recorded once and then
 * corrected as a new version; only a doctor reviews; a cancelled or resulted order cannot be
 * cancelled. Synthetic people only.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function catalogue(): Mutable<Investigation>[] {
  return [
    {
      id: "inv-fbc",
      kind: "lab",
      name: "Full blood count",
      code: "58410-2",
      unit: "g/dL",
      reference_range: "12 - 16",
      price_minor: 450_000,
      currency: "NGN",
      active: true,
    },
    {
      id: "inv-xray",
      kind: "imaging",
      name: "Chest X-ray",
      code: "",
      unit: "",
      reference_range: "",
      price_minor: 900_000,
      currency: "NGN",
      active: true,
    },
  ];
}

function order(
  id: string,
  patient: string,
  mrn: string,
  test: Mutable<Investigation>,
  status: DiagnosticOrder["status"],
  hours: number,
): Mutable<DiagnosticOrder> {
  return {
    id,
    patient: `patient-${id}`,
    patient_name: patient,
    patient_mrn: mrn,
    investigation: test.id,
    investigation_name: test.name,
    kind: test.kind,
    reason: "Fever for three days",
    priority: "routine",
    status,
    encounter_id: null,
    unit_price_minor: test.price_minor ?? 0,
    currency: "NGN",
    ordered_by_name: "Ada Okoro",
    created_at: ago(hours),
    collected_at: null,
    cancelled_reason: "",
    current_result: null,
  };
}

function seeded() {
  const tests = catalogue();
  const resulted = order("ord-03", "Chidi Nwosu", "2026-000203", tests[0], "resulted", 6);
  resulted.current_result = {
    id: "res-03",
    order: "ord-03",
    version: 1,
    superseded: false,
    value: "10.2",
    unit: "g/dL",
    reference_range: "12 - 16",
    flag: "abnormal",
    report: "",
    reported_by_name: "Lab Tech",
    reported_at: ago(2),
    correction_reason: "",
    is_reviewed: false,
    reviewed_at: null,
  };
  return {
    tests,
    orders: [
      order("ord-01", "Tolu Okafor", "2026-000201", tests[0], "ordered", 1),
      order("ord-02", "Bisi Lawal", "2026-000202", tests[1], "ordered", 3),
      resulted,
    ],
  };
}

export const diagnostics: {
  tests: Mutable<Investigation>[];
  orders: Mutable<DiagnosticOrder>[];
  calls: { path: string; body: unknown }[];
} = { ...seeded(), calls: [] };

export function resetDiagnosticsMocks(): void {
  Object.assign(diagnostics, seeded(), { calls: [] });
}

const failure = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, details: {} } }, { status });

const SEES = ["doctor", "nurse", "lab_technician", "tenant_admin"];

function who(allowed: readonly string[]) {
  const me = mockSignedIn();
  if (!me) return { refused: failure(401, "not_authenticated", "Not signed in.") };
  const ok = me.roles.some((r) => allowed.includes(r));
  return ok
    ? { me }
    : { refused: failure(403, "permission_denied", "You do not have permission.") };
}

const page = <T>(rows: T[], url: URL) => {
  const size = Number(url.searchParams.get("page_size") ?? 50);
  const number = Number(url.searchParams.get("page") ?? 1);
  return HttpResponse.json({
    count: rows.length,
    next: null,
    previous: null,
    results: rows.slice((number - 1) * size, number * size),
  });
};

export const diagnosticsHandlers = [
  http.get("*/api/diagnostics/investigations/", ({ request }) => {
    const { refused } = who([...SEES, "billing_officer", "finance"]);
    if (refused) return refused;
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    return page(
      diagnostics.tests.filter((t) => !kind || t.kind === kind),
      url,
    );
  }),

  http.post("*/api/diagnostics/investigations/", async ({ request }) => {
    const { refused } = who(["tenant_admin"]);
    if (refused) return refused;
    const body = (await request.json()) as Omit<Investigation, "id">;
    diagnostics.calls.push({ path: "investigations", body });
    const created = { ...body, id: `inv-${diagnostics.tests.length + 1}` };
    diagnostics.tests.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch("*/api/diagnostics/investigations/:id/", async ({ params, request }) => {
    const { refused } = who(["tenant_admin"]);
    if (refused) return refused;
    const found = diagnostics.tests.find((t) => t.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as Partial<Investigation>;
    diagnostics.calls.push({ path: `investigations/${found.id}`, body });
    Object.assign(found, body);
    return HttpResponse.json(found);
  }),

  http.get("*/api/diagnostics/orders/", ({ request }) => {
    const { refused } = who(SEES);
    if (refused) return refused;
    const url = new URL(request.url);
    const statuses = url.searchParams.get("status")?.split(",");
    const kind = url.searchParams.get("kind");
    const patient = url.searchParams.get("patient");
    return page(
      diagnostics.orders
        .filter((o) => !statuses || statuses.includes(o.status))
        .filter((o) => !kind || o.kind === kind)
        .filter((o) => !patient || o.patient === patient),
      url,
    );
  }),

  http.post("*/api/diagnostics/orders/", async ({ request }) => {
    const { refused } = who(["doctor"]);
    if (refused) return refused;
    const body = (await request.json()) as {
      patient: string;
      investigation: string;
      reason: string;
      priority: DiagnosticOrder["priority"];
    };
    diagnostics.calls.push({ path: "orders", body });
    const test = diagnostics.tests.find((t) => t.id === body.investigation);
    if (!test?.active) return failure(409, "order_refused", "That test is not offered.");
    const created = order(
      `ord-${diagnostics.orders.length + 1}`,
      "Ife Bello",
      "2026-000209",
      test,
      "ordered",
      0,
    );
    created.patient = body.patient;
    created.reason = body.reason;
    created.priority = body.priority;
    diagnostics.orders.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.post("*/api/diagnostics/orders/:id/collect/", ({ params }) => {
    const { refused } = who(["lab_technician"]);
    if (refused) return refused;
    const found = diagnostics.orders.find((o) => o.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    diagnostics.calls.push({ path: `orders/${found.id}/collect`, body: null });
    if (found.status !== "ordered") {
      return failure(409, "order_refused", "This order is already under way.");
    }
    found.status = "collected";
    found.collected_at = new Date().toISOString();
    return HttpResponse.json(found);
  }),

  http.post("*/api/diagnostics/orders/:id/cancel/", async ({ params, request }) => {
    const { refused } = who(["doctor", "lab_technician"]);
    if (refused) return refused;
    const found = diagnostics.orders.find((o) => o.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as { reason: string };
    diagnostics.calls.push({ path: `orders/${found.id}/cancel`, body });
    if (found.status === "resulted") {
      return failure(409, "order_refused", "A result has been recorded; ask for a correction.");
    }
    found.status = "cancelled";
    found.cancelled_reason = body.reason;
    return HttpResponse.json(found);
  }),

  http.post("*/api/diagnostics/results/", async ({ request }) => {
    const { refused } = who(["lab_technician"]);
    if (refused) return refused;
    const body = (await request.json()) as {
      order: string;
      value?: string;
      report?: string;
      flag: DiagnosticResult["flag"];
    };
    diagnostics.calls.push({ path: "results", body });
    const found = diagnostics.orders.find((o) => o.id === body.order);
    if (!found) return failure(400, "validation_error", "Choose an order.");
    if (found.status === "resulted") {
      return failure(409, "result_refused", "A result is already recorded.");
    }
    const result: DiagnosticResult = {
      id: `res-${found.id}`,
      order: found.id,
      version: 1,
      superseded: false,
      value: body.value ?? "",
      unit: "",
      reference_range: "",
      flag: body.flag,
      report: body.report ?? "",
      reported_by_name: "Lab Tech",
      reported_at: new Date().toISOString(),
      correction_reason: "",
      is_reviewed: false,
      reviewed_at: null,
    };
    found.status = "resulted";
    found.current_result = result;
    return HttpResponse.json(result, { status: 201 });
  }),

  http.post("*/api/diagnostics/results/:id/correct/", async ({ params, request }) => {
    const { refused } = who(["lab_technician"]);
    if (refused) return refused;
    const found = diagnostics.orders.find((o) => o.current_result?.id === params.id);
    if (!found?.current_result) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as Partial<DiagnosticResult> & { reason: string };
    diagnostics.calls.push({ path: `results/${params.id}/correct`, body });
    found.current_result = {
      ...found.current_result,
      version: found.current_result.version + 1,
      value: body.value ?? "",
      report: body.report ?? "",
      flag: body.flag ?? "normal",
      correction_reason: body.reason,
      is_reviewed: false,
      reviewed_at: null,
    };
    return HttpResponse.json(found.current_result, { status: 201 });
  }),

  http.post("*/api/diagnostics/results/:id/review/", ({ params }) => {
    const { refused } = who(["doctor"]);
    if (refused) return refused;
    const found = diagnostics.orders.find((o) => o.current_result?.id === params.id);
    if (!found?.current_result) return failure(404, "not_found", "Not found.");
    diagnostics.calls.push({ path: `results/${params.id}/review`, body: null });
    found.current_result = {
      ...found.current_result,
      is_reviewed: true,
      reviewed_at: new Date().toISOString(),
    };
    return HttpResponse.json(found.current_result);
  }),
];
