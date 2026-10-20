import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";
import { addDays, instantAt, LAGOS_OFFSET } from "@/lib/calendar";
import { lagosToday } from "@/lib/format";

import { mockSignedIn } from "./auth";
import { CHART_PATIENT, OPEN_VISIT } from "./chart";

/**
 * The appointments calendar's API, shaped like apps/scheduling and apps/staff, with the rules
 * the screen relies on: a physician cannot be double-booked (409 slot_taken), only booked or
 * confirmed appointments move, a cancellation needs a reason. Synthetic data only.
 */
export const ADA = "8a5e2f8c-0000-4000-8000-000000000010";
export const KEMI = "8a5e2f8c-0000-4000-8000-000000000011";
const FACILITY = "8a5e2f8c-0000-4000-8000-0000000000bb";

function physician(id: string, user: string, display_name: string): Schemas["StaffProfile"] {
  return {
    id,
    user,
    display_name,
    staff_type: "physician",
    licence_verification: "verified",
    licence_verified_at: null,
    licence_verification_reference: "",
    licence_flag: "ok",
    on_duty: true,
  } as Schemas["StaffProfile"];
}

export const PHYSICIANS: Schemas["StaffProfile"][] = [
  physician("p1", ADA, "Dr Ada Tester"),
  physician("p2", KEMI, "Dr Kemi Okoro"),
];

type Row = Schemas["Appointment"] & { end_at: string };
type State = {
  rows: Row[];
  calls: { path: string; body: unknown }[];
};

export const appointments: State = { rows: [], calls: [] };

/** An appointment from `hour:minute` (Lagos) on `date`, 30 minutes long. */
export function appointmentAt(
  id: string,
  who: string,
  hour: number,
  minute: number,
  extra: Partial<Row> = {},
  date = lagosToday(),
): Row {
  const from = hour * 60 + minute;
  return {
    id,
    patient: CHART_PATIENT,
    patient_name: "Ngozi Eze",
    patient_mrn: "2026-000301",
    physician: who,
    facility: FACILITY,
    department: null,
    appointment_type: "new",
    start_at: instantAt(date, from),
    end_at: instantAt(date, from + 30),
    status: "booked",
    reason: "Headache",
    cancellation_reason: "",
    cancelled_at: null,
    triage_priority: null,
    checked_in_at: null,
    checked_in_by: null,
    consultation_started_at: null,
    completed_at: null,
    encounter_id: null,
    series_id: null,
    created_at: new Date().toISOString(),
    ...extra,
  };
}

export function resetAppointmentMocks(rows?: Row[]): void {
  appointments.calls = [];
  appointments.rows = rows ?? [
    appointmentAt("a1", ADA, 9, 0),
    appointmentAt("a2", ADA, 11, 0, { status: "in_consultation", encounter_id: OPEN_VISIT }),
    appointmentAt("a3", KEMI, 10, 0, { status: "confirmed", patient_name: "Tunde Bello" }),
    appointmentAt(
      "a4",
      KEMI,
      13,
      0,
      { status: "completed", patient_name: "Chidi Obi" },
      addDays(lagosToday(), -2),
    ),
  ];
}
resetAppointmentMocks();

const page = <T>(results: T[]) =>
  HttpResponse.json({ count: results.length, next: null, previous: null, results });

const failure = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const overlaps = (a: Row, start: number, end: number) =>
  Date.parse(a.start_at) < end && start < Date.parse(a.end_at);

export const appointmentHandlers = [
  http.get("*/api/staff/profiles/", () => page(PHYSICIANS)),

  http.get("*/api/scheduling/appointments/", ({ request }) => {
    if (!mockSignedIn()) return failure(401, "not_authenticated", "Not signed in.");
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const status = url.searchParams.get("status")?.split(",");
    const who = url.searchParams.get("physician");
    return page(
      appointments.rows.filter(
        (a) =>
          (!from || Date.parse(a.start_at) >= Date.parse(from)) &&
          (!to || Date.parse(a.start_at) < Date.parse(to)) &&
          (!status || status.includes(a.status)) &&
          (!who || a.physician === who),
      ),
    );
  }),

  // Working hours 08:00 to 17:00 every day, for both physicians.
  http.get("*/api/scheduling/availability/", ({ request }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return page([]);
    const out: unknown[] = [];
    for (
      let day = from.slice(0, 10);
      Date.parse(`${day}T00:00:00${LAGOS_OFFSET}`) < Date.parse(to);
      day = addDays(day, 1)
    ) {
      for (const who of [ADA, KEMI]) {
        out.push({
          id: `w-${who}-${day}`,
          physician: who,
          facility: FACILITY,
          start_at: instantAt(day, 8 * 60),
          end_at: instantAt(day, 17 * 60),
        });
      }
    }
    return page(out);
  }),

  http.post("*/api/scheduling/appointments/", async ({ request }) => {
    const body = (await request.json()) as Partial<Row>;
    appointments.calls.push({ path: "create", body });
    const start = Date.parse(body.start_at!);
    const end = body.end_at ? Date.parse(body.end_at) : start + 30 * 60_000;
    if (appointments.rows.some((a) => a.physician === body.physician && overlaps(a, start, end))) {
      return failure(409, "slot_taken", "That time is taken.");
    }
    const row = appointmentAt(`new-${appointments.rows.length}`, body.physician!, 0, 0, {
      ...body,
      end_at: body.end_at ?? new Date(end).toISOString(),
    });
    appointments.rows.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),

  http.post("*/api/scheduling/appointments/:id/reschedule/", async ({ params, request }) => {
    const body = (await request.json()) as {
      start_at: string;
      end_at?: string;
      physician?: string;
    };
    appointments.calls.push({ path: `reschedule/${String(params.id)}`, body });
    const row = appointments.rows.find((a) => a.id === params.id)!;
    if (row.status !== "booked" && row.status !== "confirmed") {
      return failure(400, "invalid_transition", "Only booked or confirmed appointments can move.");
    }
    const length = Date.parse(row.end_at) - Date.parse(row.start_at);
    const start = Date.parse(body.start_at);
    const end = body.end_at ? Date.parse(body.end_at) : start + length;
    const who = body.physician ?? row.physician;
    const clash = appointments.rows.some(
      (a) => a.id !== row.id && a.physician === who && overlaps(a, start, end),
    );
    if (clash) return failure(409, "slot_taken", "That time is taken.");
    Object.assign(row, {
      start_at: body.start_at,
      end_at: new Date(end).toISOString(),
      physician: who,
    });
    return HttpResponse.json(row);
  }),

  http.post("*/api/scheduling/appointments/:id/status/", async ({ params, request }) => {
    const body = (await request.json()) as { status: Row["status"]; cancellation_reason: string };
    appointments.calls.push({ path: `status/${String(params.id)}`, body });
    if (body.status === "cancelled" && !body.cancellation_reason.trim()) {
      return failure(400, "validation_error", "A reason is required.", {
        cancellation_reason: ["A reason is required."],
      });
    }
    const row = appointments.rows.find((a) => a.id === params.id)!;
    Object.assign(row, { status: body.status, cancellation_reason: body.cancellation_reason });
    return HttpResponse.json(row);
  }),
];
