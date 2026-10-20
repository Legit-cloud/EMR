import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

import { mockSignedIn } from "./auth";

type Row = Schemas["PatientList"];

/**
 * The patient register, duplicate check and registration, shaped like apps/patients.
 * Synthetic people only. A registration with the same name and birth date as one of them
 * is held (409), as the API does above 85%.
 */
const FIRST = [
  "Adaeze",
  "Bayo",
  "Chidi",
  "Damilola",
  "Emeka",
  "Funmi",
  "Garba",
  "Halima",
  "Ifeoma",
  "Jide",
];
const LAST = ["Okonkwo", "Adeyemi", "Bello", "Eze", "Ibrahim", "Lawal"];

function makeRow(i: number): Row {
  const sex = (["female", "male"] as const)[i % 2];
  const allergic = i % 4 === 0;
  return {
    id: `8a5e2f8c-0000-4000-8000-0000000003${String(i).padStart(2, "0")}`,
    mrn: `2026-${String(100 + i).padStart(6, "0")}`,
    first_name: FIRST[i % FIRST.length],
    middle_name: "",
    last_name: LAST[i % LAST.length],
    date_of_birth: `${1950 + ((i * 7) % 55)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
    sex,
    national_id: "",
    phone: i % 3 === 0 ? "" : `+23480355501${String(i).padStart(2, "0")}`,
    email: "",
    address_line: "",
    city: "",
    state: "",
    country: "NG",
    status: i % 11 === 0 ? "inactive" : "active",
    deceased_at: null,
    record_state: "active",
    created_at: new Date(Date.UTC(2026, 9, 1 + (i % 18))).toISOString(),
    allergies: allergic
      ? [
          { substance: "Penicillin", severity: "severe" },
          { substance: "Peanuts", severity: "mild" },
        ]
      : [],
    last_visit: i % 2 === 0 ? new Date(Date.UTC(2026, 9, 1 + (i % 15), 9)).toISOString() : null,
  };
}

export const MOCK_PATIENTS: Row[] = Array.from({ length: 27 }, (_, i) => makeRow(i + 1));

/** What the next request should do, for testing screen states. */
type Mode = "ok" | "forbidden" | "error" | "empty";

export const patientMocks: {
  mode: Mode;
  pendingReviews: number;
  registered: Schemas["PatientRegistrationRequest"][];
  checks: number;
} = { mode: "ok", pendingReviews: 2, registered: [], checks: 0 };

export function resetPatientMocks(): void {
  patientMocks.mode = "ok";
  patientMocks.pendingReviews = 2;
  patientMocks.registered = [];
  patientMocks.checks = 0;
}

const failure = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const folded = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function ordered(rows: Row[], ordering: string | null): Row[] {
  const key = ordering?.replace(/^-/, "") ?? "created_at";
  const sign = ordering?.startsWith("-") || !ordering ? -1 : 1;
  const value = (r: Row) =>
    key === "name"
      ? `${folded(r.last_name)} ${folded(r.first_name)}`
      : key === "mrn"
        ? r.mrn
        : key === "date_of_birth"
          ? r.date_of_birth
          : r.created_at;
  return [...rows].sort((a, b) => (value(a) < value(b) ? -sign : value(a) > value(b) ? sign : 0));
}

export const patientHandlers = [
  http.get("*/api/patients/patients/", ({ request }) => {
    if (!mockSignedIn()) return failure(401, "not_authenticated", "Not signed in.");
    if (patientMocks.mode === "forbidden") {
      return failure(403, "permission_denied", "You do not have permission.");
    }
    if (patientMocks.mode === "error") return failure(500, "error", "Server error.");
    const url = new URL(request.url);
    const get = (name: string) => url.searchParams.get(name);
    let rows = patientMocks.mode === "empty" ? [] : MOCK_PATIENTS;
    const q = folded(get("q") ?? "");
    if (q) {
      rows = rows.filter((r) =>
        [folded(`${r.first_name} ${r.last_name}`), r.mrn.toLowerCase()].some((t) => t.includes(q)),
      );
    }
    if (get("status")) rows = rows.filter((r) => r.status === get("status"));
    if (get("allergy") === "true") rows = rows.filter((r) => r.allergies.length > 0);
    rows = ordered(rows, get("ordering"));
    const size = Number(get("page_size") ?? 50);
    const page = Number(get("page") ?? 1);
    return HttpResponse.json({
      count: rows.length,
      next: page * size < rows.length ? `?page=${page + 1}` : null,
      previous: page > 1 ? `?page=${page - 1}` : null,
      results: rows.slice((page - 1) * size, page * size),
    });
  }),

  http.post("*/api/patients/patients/check-duplicates/", async ({ request }) => {
    patientMocks.checks += 1;
    const body = (await request.json()) as Schemas["DuplicateCheckRequest"];
    const same = (r: Row, field: "first_name" | "last_name") =>
      folded(r[field]) === folded(body[field]);
    const matches: Schemas["DuplicateMatch"][] = MOCK_PATIENTS.filter(
      (r) =>
        same(r, "last_name") && (same(r, "first_name") || r.date_of_birth === body.date_of_birth),
    ).map((r) => {
      const exact = same(r, "first_name") && r.date_of_birth === body.date_of_birth;
      return {
        patient_id: r.id,
        mrn: r.mrn,
        first_name: r.first_name,
        last_name: r.last_name,
        date_of_birth: r.date_of_birth,
        sex: r.sex,
        score: exact ? 0.97 : 0.72,
        would_hold: exact,
      };
    });
    return HttpResponse.json(matches.sort((a, b) => b.score - a.score));
  }),

  http.post("*/api/patients/patients/", async ({ request }) => {
    const body = (await request.json()) as Schemas["PatientRegistrationRequest"];
    const existing = MOCK_PATIENTS.find(
      (r) =>
        folded(r.first_name) === folded(body.first_name) &&
        folded(r.last_name) === folded(body.last_name) &&
        r.date_of_birth === body.date_of_birth,
    );
    if (existing) {
      return failure(
        409,
        "possible_duplicate",
        "This person may already be registered. The registration is held for review.",
        {
          review_id: "8a5e2f8c-0000-4000-8000-000000000999",
          candidates: [{ patient_id: existing.id, mrn: existing.mrn, score: 0.97 }],
        },
      );
    }
    if (body.first_name.toLowerCase() === "rejected") {
      return failure(400, "validation_error", "Invalid input.", {
        phone: ["Enter a phone number in international format."],
      });
    }
    patientMocks.registered.push(body);
    const created: Row = {
      ...makeRow(99),
      id: "8a5e2f8c-0000-4000-8000-000000000777",
      mrn: "2026-000777",
      first_name: body.first_name,
      last_name: body.last_name,
      date_of_birth: body.date_of_birth,
      allergies: (body.allergies ?? []).map((a) => ({
        substance: a.substance,
        severity: a.severity,
      })),
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get("*/api/patients/duplicate-reviews/", () =>
    patientMocks.pendingReviews === 0 && patientMocks.mode === "forbidden"
      ? failure(403, "permission_denied", "No access.")
      : HttpResponse.json({
          count: patientMocks.pendingReviews,
          next: null,
          previous: null,
          results: [],
        }),
  ),
];
