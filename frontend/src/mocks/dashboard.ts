import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

import { mockSignedIn } from "./auth";

/**
 * GET /api/reports/dashboard/ and the physician queue, shaped like apps/reports. Cards
 * follow the API's rule: tenant admins and finance get the figures, clinicians get their
 * own day. Amounts are synthetic, in kobo.
 */
const MONTHLY = [42, 51, 47, 63, 58, 72, 66, 81, 77, 90, 86, 98];

function periods(range: string): Schemas["FinancePeriod"][] {
  const today = new Date();
  if (range === "30d") {
    return Array.from({ length: 30 }, (_, i) => {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + i);
      const collected = (3 + ((i * 7) % 5)) * 1_000_000;
      return {
        start: day.toISOString().slice(0, 10),
        collected_minor: collected,
        billed_minor: collected + 400_000,
      };
    });
  }
  return MONTHLY.map((k, i) => {
    const month = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
    return {
      start: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`,
      collected_minor: k * 1_000_000,
      billed_minor: (k + 9) * 1_000_000,
    };
  });
}

/** Waiting times are relative to now, so they are built per request. */
export function mockQueue(): Schemas["QueueEntry"][] {
  return [
    {
      appointment_id: "8a5e2f8c-0000-4000-8000-000000000101",
      patient_id: "8a5e2f8c-0000-4000-8000-000000000001",
      patient_name: "Ngozi Synthetic",
      mrn: "2026-000101",
      appointment_type: "follow_up",
      reason: "Blood pressure review",
      triage_priority: 2,
      checked_in_at: new Date(Date.now() - 45 * 60_000).toISOString(),
      start_at: new Date(Date.now() - 50 * 60_000).toISOString(),
    },
    {
      appointment_id: "8a5e2f8c-0000-4000-8000-000000000102",
      patient_id: "8a5e2f8c-0000-4000-8000-000000000002",
      patient_name: "Emeka Synthetic",
      mrn: "2026-000102",
      appointment_type: "new",
      reason: "",
      triage_priority: null,
      checked_in_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      start_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ];
}

export const dashboardHandlers = [
  http.get("*/api/reports/dashboard/", ({ request }) => {
    const me = mockSignedIn();
    if (!me) {
      return HttpResponse.json(
        { error: { code: "not_authenticated", message: "Not signed in.", details: {} } },
        { status: 401 },
      );
    }
    const range = new URL(request.url).searchParams.get("range") ?? "12m";
    const roles = new Set<string>(me.roles);
    const figures = roles.has("tenant_admin") || roles.has("finance");
    const list = periods(range);
    const body: Schemas["Dashboard"] = {
      range,
      finance: figures
        ? {
            currency: "NGN",
            periods: list,
            collected_minor: list.reduce((sum, p) => sum + p.collected_minor, 0),
            previous_collected_minor: 70_000_000,
            revenue_mix: [
              { category: "consultation", label: "Consultations", amount_minor: 42_000_000 },
              { category: "pharmacy", label: "Pharmacy", amount_minor: 26_000_000 },
              { category: "laboratory", label: "Laboratory", amount_minor: 11_000_000 },
              { category: "procedure", label: "Procedures", amount_minor: 8_000_000 },
            ],
          }
        : null,
      patients: roles.has("tenant_admin") ? { new: 38, returning: 112 } : null,
      popular_services: figures
        ? [
            { name: "General consultation", count: 214 },
            { name: "Malaria parasite test", count: 96 },
            { name: "Antenatal visit", count: 41 },
          ]
        : null,
      stock: roles.has("tenant_admin")
        ? {
            currency: "NGN",
            value_minor: 184_350_000,
            products: 32,
            in_stock: 20,
            low: 4,
            out: 8,
            low_items: [
              {
                drug: "8a5e2f8c-0000-4000-8000-000000000201",
                name: "Metformin 500 mg",
                available: 0,
                reorder_level: 40,
              },
              {
                drug: "8a5e2f8c-0000-4000-8000-000000000202",
                name: "Amoxicillin 500 mg",
                available: 12,
                reorder_level: 30,
              },
            ],
          }
        : null,
      my_day:
        roles.has("doctor") || roles.has("nurse")
          ? { open_notes: 2, draft_prescriptions: 1, licence_expires_on: null }
          : null,
    };
    return HttpResponse.json(body);
  }),

  http.get("*/api/scheduling/appointments/queue/", () => HttpResponse.json(mockQueue())),
];
