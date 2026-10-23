import { http, HttpResponse } from "msw";

import type { StaffRequest } from "@/lib/data-requests";

import { mockSignedIn } from "./auth";

/**
 * Patients' data-protection requests as the compliance team sees them, shaped like apps/portal.
 * Answering needs a written note of at least ten characters, and a request is answered once.
 * Synthetic people only.
 */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function row(
  id: string,
  name: string,
  kind: StaffRequest["kind"],
  label: string,
  due: number,
  overdue = false,
) {
  return {
    id,
    kind,
    kind_label: label,
    details: kind === "access" ? "" : "My date of birth is wrong on my card",
    status: "open",
    due_on: day(due),
    response_note: "",
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    patient: `patient-${id}`,
    patient_name: name,
    patient_mrn: `2026-0002${id.slice(-2)}`,
    overdue,
    handled_at: null,
  } as StaffRequest;
}

function seeded(): Mutable<StaffRequest>[] {
  return [
    row("req-01", "Tolu Okafor", "access", "A copy of my records", -3, true),
    row("req-02", "Bisi Lawal", "correction", "Correct something wrong", 12),
    row("req-03", "Chidi Nwosu", "erasure", "Delete my information", 25),
  ];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const dataRequests: {
  rows: Mutable<StaffRequest>[];
  calls: { id: string; body: unknown }[];
  forbidden: boolean;
} = {
  rows: seeded(),
  calls: [],
  forbidden: false,
};

export function resetDataRequestMocks(): void {
  dataRequests.rows = seeded();
  dataRequests.calls = [];
  dataRequests.forbidden = false;
}

const failure = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, details: {} } }, { status });

function refusal() {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  const allowed = me.roles.some((r) => r === "compliance_officer" || r === "tenant_admin");
  return allowed && !dataRequests.forbidden
    ? null
    : failure(403, "permission_denied", "You do not have permission.");
}

export const dataRequestHandlers = [
  http.get("*/api/portal/data-requests/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const overdue = url.searchParams.get("overdue") === "true";
    const found = dataRequests.rows
      .filter((r) => !status || r.status === status)
      .filter((r) => !overdue || r.overdue)
      .sort((a, b) => a.due_on.localeCompare(b.due_on));
    const size = Number(url.searchParams.get("page_size") ?? 50);
    const page = Number(url.searchParams.get("page") ?? 1);
    return HttpResponse.json({
      count: found.length,
      next: null,
      previous: null,
      results: found.slice((page - 1) * size, page * size),
    });
  }),

  http.post("*/api/portal/data-requests/:id/respond/", async ({ params, request }) => {
    const refused = refusal();
    if (refused) return refused;
    const found = dataRequests.rows.find((r) => r.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as { status: "completed" | "refused"; note: string };
    dataRequests.calls.push({ id: found.id, body });
    if (found.status !== "open") {
      return failure(409, "portal_account_refused", "This request has already been answered.");
    }
    if (body.note.trim().length < 10) {
      return failure(409, "portal_account_refused", "Say what was done, or why it was refused.");
    }
    found.status = body.status;
    found.response_note = body.note;
    found.overdue = false;
    return HttpResponse.json(found);
  }),
];
