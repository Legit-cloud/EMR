import { http, HttpResponse } from "msw";

import type { Claim } from "@/lib/claims";

import { mockSignedIn } from "./auth";

/**
 * Insurer claims as apps/billing serves them. A claim is sent, then approved (all or part) or
 * rejected with a reason; a rejected one is sent again; money is recorded against an approved
 * claim, and the same remittance reference is only counted once. Synthetic people only.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function claim(
  id: string,
  name: string,
  status: Claim["status"],
  claimed: number,
  extra: Partial<Claim> = {},
): Mutable<Claim> {
  return {
    id,
    reference: `CLM-${id.toUpperCase()}`,
    insurer_reference: "",
    invoice: `inv-${id}`,
    invoice_reference: `INV-${id.toUpperCase()}`,
    patient_name: name,
    patient_mrn: "2026-000300",
    insurer: "hmo-1",
    insurer_name: "Synthetic HMO",
    status,
    currency: "NGN",
    claimed_minor: claimed,
    approved_minor: null,
    received_minor: 0,
    outstanding_minor: 0,
    attempt: status === "draft" ? 0 : 1,
    submitted_at: status === "draft" ? null : ago(12),
    decided_at: null,
    settled_at: null,
    decision_note: "",
    created_at: ago(14),
    ...extra,
  };
}

function seeded(): Mutable<Claim>[] {
  return [
    claim("a1", "Tolu Okafor", "draft", 800_000),
    claim("b2", "Bisi Lawal", "submitted", 1_200_000),
    claim("c3", "Chidi Nwosu", "approved", 600_000, {
      approved_minor: 600_000,
      outstanding_minor: 600_000,
    }),
    claim("d4", "Dayo Ade", "rejected", 400_000, {
      decision_note: "Pre-authorisation was missing",
    }),
    claim("e5", "Ife Bello", "paid", 300_000, { approved_minor: 300_000, received_minor: 300_000 }),
  ];
}

export const claims: {
  rows: Mutable<Claim>[];
  calls: { path: string; body: unknown }[];
  references: Set<string>;
} = { rows: seeded(), calls: [], references: new Set() };

export function resetClaimMocks(): void {
  claims.rows = seeded();
  claims.calls = [];
  claims.references = new Set();
}

const failure = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, details: {} } }, { status });

function who(allowed: readonly string[]) {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  return me.roles.some((r) => allowed.includes(r))
    ? null
    : failure(403, "permission_denied", "You do not have permission.");
}

const LOOK = ["billing_officer", "finance", "tenant_admin"];

export const claimHandlers = [
  http.get("*/api/billing/claims/ageing/", () => {
    const refused = who(LOOK);
    if (refused) return refused;
    return HttpResponse.json([
      { band: "0-30", claims: 2, outstanding_minor: 1_800_000 },
      { band: "31-60", claims: 0, outstanding_minor: 0 },
      { band: "61-90", claims: 0, outstanding_minor: 0 },
      { band: "over 90", claims: 0, outstanding_minor: 0 },
    ]);
  }),

  http.get("*/api/billing/claims/", ({ request }) => {
    const refused = who(LOOK);
    if (refused) return refused;
    const url = new URL(request.url);
    const statuses = url.searchParams.get("status")?.split(",");
    const found = claims.rows.filter((c) => !statuses || statuses.includes(c.status));
    return HttpResponse.json({ count: found.length, next: null, previous: null, results: found });
  }),

  http.post("*/api/billing/claims/:id/:verb/", async ({ params, request }) => {
    const refused = who(["billing_officer"]);
    if (refused) return refused;
    const found = claims.rows.find((c) => c.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as Record<string, string | number>;
    const verb = String(params.verb);
    claims.calls.push({ path: `${found.id}/${verb}`, body });
    const refuse = (message: string) => failure(409, "claim_refused", message);

    if (verb === "submit") {
      if (found.status !== "draft" && found.status !== "rejected") {
        return refuse("That claim cannot be sent.");
      }
      found.status = "submitted";
      found.attempt += 1;
      found.submitted_at = new Date().toISOString();
      found.decision_note = "";
      if (body.insurer_reference) found.insurer_reference = String(body.insurer_reference);
    } else if (verb === "approve") {
      const amount = Number(body.approved_minor);
      if (found.status !== "submitted") return refuse("Only a submitted claim can be approved.");
      if (amount < 1 || amount > found.claimed_minor) return refuse("That amount is not allowed.");
      if (amount < found.claimed_minor && String(body.note ?? "").trim().length < 5) {
        return refuse("Say why the insurer approved less than was claimed.");
      }
      found.status = "approved";
      found.approved_minor = amount;
      found.outstanding_minor = amount;
    } else if (verb === "reject") {
      if (found.status !== "submitted") return refuse("Only a submitted claim can be rejected.");
      found.status = "rejected";
      found.decision_note = String(body.reason);
    } else if (verb === "settle") {
      const amount = Number(body.amount_minor);
      const key = `${found.id}:${body.reference}`;
      if (found.status !== "approved") return refuse("The claim is not approved.");
      if (!claims.references.has(key)) {
        if (amount < 1 || amount > found.outstanding_minor) {
          return refuse("The insurer owes less than that.");
        }
        claims.references.add(key);
        found.received_minor += amount;
        found.outstanding_minor -= amount;
        if (found.outstanding_minor === 0) found.status = "paid";
      }
    } else {
      return failure(404, "not_found", "Not found.");
    }
    return HttpResponse.json(found);
  }),
];
