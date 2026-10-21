import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

import { mockSignedIn } from "./auth";

/**
 * The audit log, shaped like apps/audit: newest first, filterable by action, outcome, dates and
 * text, with a summary and a CSV export. Synthetic entries only.
 */
type Entry = Schemas["AuditEntry"];

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

let n = 0;
function entry(
  hours: number,
  who: string,
  action: Entry["action"],
  resource: string,
  options: { outcome?: Entry["outcome"]; reason?: string; path?: string } = {},
): Entry {
  n += 1;
  return {
    id: `audit-${n}`,
    sequence: 1000 - n,
    occurred_at: hoursAgo(hours),
    actor_id: `user-${who}`,
    actor_label: who,
    action,
    outcome: options.outcome ?? "allowed",
    resource,
    object_id: `obj-${n}`,
    reason: options.reason ?? "",
    ip_address: "10.0.0.5",
    user_agent: "test",
    method: action === "read" ? "GET" : "POST",
    path: options.path ?? `/api/${resource.replace(".", "/")}/`,
    details: {},
    entry_hash: `hash-${n}`,
  };
}

function seeded(): Entry[] {
  n = 0;
  return [
    entry(1, "dr.ada", "read", "patients.patient"),
    entry(2, "dr.ada", "break_glass", "patients.patient", {
      reason: "Patient collapsed in the waiting area",
    }),
    entry(3, "nurse.bola", "update", "clinical.vitalsign"),
    entry(5, "front.desk", "read", "billing.invoice", { outcome: "denied" }),
    entry(8, "compliance.chi", "break_glass_review", "patients.patient", {
      reason: "Justified: emergency",
    }),
    entry(26, "bill.ngozi", "create", "billing.payment"),
    entry(30, "dr.ada", "read", "clinical.encounter"),
    entry(50, "nurse.bola", "break_glass", "patients.patient", {
      reason: "Covering the night shift for Ward B",
    }),
    entry(60, "unknown", "login_failed", "", {
      outcome: "failed",
      path: "/api/accounts/auth/login/",
    }),
    entry(80, "pita.pharmacist", "update", "pharmacy.prescription"),
    entry(100, "dr.ada", "login", ""),
    entry(120, "bill.ngozi", "read", "billing.invoice"),
  ];
}

export const auditMock = { entries: seeded(), forbidden: false, exports: 0 };

export function resetAuditMocks(): void {
  auditMock.entries = seeded();
  auditMock.forbidden = false;
  auditMock.exports = 0;
}

function failure(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, details: {} } }, { status });
}

function refusal() {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  const allowed = me.roles.some((r) => r === "compliance_officer" || r === "tenant_admin");
  return allowed && !auditMock.forbidden
    ? null
    : failure(403, "permission_denied", "You do not have permission.");
}

function matching(url: URL): Entry[] {
  const get = (name: string) => url.searchParams.get(name);
  const q = (get("q") ?? "").toLowerCase();
  const from = get("date_from");
  const to = get("date_to");
  return auditMock.entries.filter((e) => {
    const day = e.occurred_at.slice(0, 10);
    return (
      (!get("action") || e.action === get("action")) &&
      (!get("outcome") || e.outcome === get("outcome")) &&
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!q || `${e.actor_label} ${e.resource} ${e.path} ${e.reason}`.toLowerCase().includes(q))
    );
  });
}

export const auditHandlers = [
  http.get("*/api/audit/entries/summary/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const found = matching(new URL(request.url));
    return HttpResponse.json({
      total: found.length,
      denied: found.filter((e) => e.outcome === "denied").length,
      break_glass: found.filter((e) => e.action === "break_glass").length,
      reviewed: found.filter((e) => e.action === "break_glass_review").length,
    } satisfies Schemas["AuditSummary"]);
  }),

  http.get("*/api/audit/entries/export/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    auditMock.exports += 1;
    const rows = matching(new URL(request.url)).map(
      (e) => `${e.occurred_at},${e.sequence},${e.actor_label},${e.action},${e.outcome}`,
    );
    return new HttpResponse(["occurred_at,sequence,actor,action,outcome", ...rows].join("\n"), {
      headers: { "Content-Type": "text/csv" },
    });
  }),

  http.get("*/api/audit/entries/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const url = new URL(request.url);
    const found = matching(url);
    const size = Number(url.searchParams.get("page_size") ?? 50);
    const page = Number(url.searchParams.get("page") ?? 1);
    return HttpResponse.json({
      count: found.length,
      next: null,
      previous: null,
      results: found.slice((page - 1) * size, page * size),
    });
  }),
];
