import { http, HttpResponse } from "msw";

import type { Bed, DischargeStatus, Occupant, Ward } from "@/lib/inpatient";

import { mockSignedIn } from "./auth";
import { MOCK_PATIENTS } from "./patients";

/**
 * Inpatient wards and beds. There is no backend for this module yet, so this mock is the
 * contract the screen is built against (see docs/adr/0020). Rules it enforces, from
 * CLAUDE.md Section 5: admitting needs a vacant bed and makes it Occupied in one step; a
 * patient is in one bed at a time; transferring frees the old bed (to Cleaning) and takes a new
 * one; a discharge ends as Discharged, LAMA or Transferred and sends the bed to Cleaning.
 * Synthetic people only.
 */
type State = {
  wards: Ward[];
  /** Requests received, for assertions. */
  calls: { path: string; body: unknown }[];
  next: number;
  forbidden: boolean;
};

export const BED_VACANT = "bed-m-3";
export const BED_OCCUPIED = "bed-m-1";
export const BED_CLEANING = "bed-m-5";
export const BED_OUT = "bed-m-6";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function occupant(n: number, name: string, mrn: string, days: number, reason: string): Occupant {
  return {
    admission: `adm-${n}`,
    patient: `patient-adm-${n}`,
    patient_name: name,
    patient_mrn: mrn,
    admitted_at: daysAgo(days),
    reason,
  };
}

function bed(id: string, label: string, status: Bed["status"], who: Occupant | null = null): Bed {
  return { id, label, status, occupant: who };
}

function seeded(): State {
  return {
    wards: [
      {
        id: "ward-m",
        name: "Medical ward",
        beds: [
          bed(
            "bed-m-1",
            "Bed 1",
            "occupied",
            occupant(1, "Ngozi Eze", "2026-000101", 2, "Severe malaria"),
          ),
          bed(
            "bed-m-2",
            "Bed 2",
            "occupied",
            occupant(2, "Tunde Bello", "2026-000102", 0, "Hypertensive crisis"),
          ),
          bed("bed-m-3", "Bed 3", "vacant"),
          bed("bed-m-4", "Bed 4", "vacant"),
          bed("bed-m-5", "Bed 5", "cleaning"),
          bed("bed-m-6", "Bed 6", "out_of_service"),
        ],
      },
      {
        id: "ward-p",
        name: "Paediatrics",
        beds: [
          bed(
            "bed-p-1",
            "Cot 1",
            "occupied",
            occupant(3, "Amina Lawal", "2026-000103", 4, "Pneumonia"),
          ),
          bed("bed-p-2", "Cot 2", "vacant"),
          bed("bed-p-3", "Cot 3", "vacant"),
        ],
      },
    ],
    calls: [],
    next: 10,
    forbidden: false,
  };
}

export const inpatient: State = seeded();

export function resetInpatientMocks(): void {
  Object.assign(inpatient, seeded());
}

const failure = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, details: {} } }, { status });

const VIEWERS = ["nurse", "doctor", "tenant_admin"];
const NURSING = ["nurse", "doctor"];

function refusal(write: boolean) {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  const allowed = write ? NURSING : VIEWERS;
  return inpatient.forbidden || !me.roles.some((r) => allowed.includes(r))
    ? failure(403, "permission_denied", "You do not have permission.")
    : null;
}

const findBed = (id: string) =>
  inpatient.wards.flatMap((w) => w.beds).find((b) => b.id === id) ?? null;
const bedOf = (admission: string) =>
  inpatient.wards.flatMap((w) => w.beds).find((b) => b.occupant?.admission === admission) ?? null;

export const inpatientHandlers = [
  http.get("*/api/inpatient/wards/", () => {
    const refused = refusal(false);
    return refused ?? HttpResponse.json(inpatient.wards);
  }),

  http.post("*/api/inpatient/admissions/", async ({ request }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const body = (await request.json()) as { patient: string; bed: string; reason: string };
    inpatient.calls.push({ path: "admit", body });
    const target = findBed(body.bed);
    if (!target) return failure(404, "not_found", "Not found.");
    if (target.status !== "vacant") {
      return failure(
        409,
        "bed_unavailable",
        `${target.label} is ${target.status.replace("_", " ")}.`,
      );
    }
    if (inpatient.wards.flatMap((w) => w.beds).some((b) => b.occupant?.patient === body.patient)) {
      return failure(409, "already_admitted", "This patient is already admitted.");
    }
    const patient = MOCK_PATIENTS.find((p) => p.id === body.patient);
    const who: Occupant = {
      admission: `adm-${inpatient.next++}`,
      patient: body.patient,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}` : "Unknown patient",
      patient_mrn: patient?.mrn ?? "",
      admitted_at: new Date().toISOString(),
      reason: body.reason,
    };
    target.status = "occupied";
    target.occupant = who;
    return HttpResponse.json(who, { status: 201 });
  }),

  http.post("*/api/inpatient/admissions/:id/transfer/", async ({ params, request }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const body = (await request.json()) as { bed: string; reason: string };
    inpatient.calls.push({ path: "transfer", body });
    const from = bedOf(String(params.id));
    const to = findBed(body.bed);
    if (!from?.occupant || !to) return failure(404, "not_found", "Not found.");
    if (to.status !== "vacant") {
      return failure(409, "bed_unavailable", `${to.label} is ${to.status.replace("_", " ")}.`);
    }
    to.status = "occupied";
    to.occupant = from.occupant;
    from.status = "cleaning";
    from.occupant = null;
    return HttpResponse.json(to.occupant);
  }),

  http.post("*/api/inpatient/admissions/:id/discharge/", async ({ params, request }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const body = (await request.json()) as { status: DischargeStatus; note: string };
    inpatient.calls.push({ path: "discharge", body });
    const from = bedOf(String(params.id));
    if (!from) return failure(404, "not_found", "Not found.");
    if (body.status !== "discharged" && body.note.trim().length < 5) {
      return failure(400, "validation_error", "Add a note for this kind of discharge.");
    }
    from.status = "cleaning";
    from.occupant = null;
    return HttpResponse.json({ status: body.status });
  }),

  http.post("*/api/inpatient/beds/:id/ready/", ({ params }) => {
    const refused = refusal(true);
    if (refused) return refused;
    const target = findBed(String(params.id));
    if (!target) return failure(404, "not_found", "Not found.");
    inpatient.calls.push({ path: "ready", body: null });
    if (target.status !== "cleaning") {
      return failure(409, "bed_unavailable", "Only a bed being cleaned can be marked ready.");
    }
    target.status = "vacant";
    return HttpResponse.json(target);
  }),
];
