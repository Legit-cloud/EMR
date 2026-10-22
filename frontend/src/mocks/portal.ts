import { http, HttpResponse } from "msw";

import type {
  ConsentKey,
  PortalAppointment,
  PortalHome,
  PortalInvoice,
  PortalPrescription,
  PortalProfile,
  PortalResult,
  PortalSlot,
} from "@/lib/portal";

import { mockSignedIn } from "./auth";

/**
 * The patient portal for one signed-in patient, shaped like apps/portal (docs/adr/0022); the
 * stand-in the unit tests use for the real API. Rules it enforces: only a
 * patient may call it; a booking takes a free slot; an appointment can be cancelled only while
 * it is booked or confirmed and still more than two hours away, with a reason; there is
 * no way to record a payment from the portal. Synthetic person only.
 */
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

type State = {
  appointments: PortalAppointment[];
  slots: PortalSlot[];
  results: PortalResult[];
  prescriptions: PortalPrescription[];
  invoices: PortalInvoice[];
  profile: PortalProfile;
  calls: { path: string; body: unknown }[];
  next: number;
  forbidden: boolean;
};

export const APPT_UPCOMING = "pa-1";
export const APPT_PAST = "pa-2";
export const RESULT_LOW = "pr-1";
export const RESULT_NORMAL = "pr-2";
export const RESULT_SCAN = "pr-3";
export const INVOICE_DUE = "pi-1";
export const INVOICE_PAID = "pi-2";
export const SLOT_ONE = "slot-1";

function seeded(): State {
  const consents: Record<ConsentKey, boolean> = {
    sms_reminders: true,
    email_reminders: false,
    share_in_facility: true,
    research: false,
  };
  return {
    appointments: [
      {
        id: APPT_UPCOMING,
        doctor_name: "Dr Ada Okafor",
        specialty: "Cardiology",
        location: "Main hospital, Outpatient",
        start_at: hours(48),
        end_at: hours(48.5),
        status: "booked",
        reason: "Blood pressure check",
        can_cancel: true,
      },
      {
        id: APPT_PAST,
        doctor_name: "Dr Bola Adeyemi",
        specialty: "Paediatrics",
        location: "Main hospital, Outpatient",
        start_at: hours(-240),
        end_at: hours(-239.5),
        status: "completed",
        reason: "Follow-up",
        can_cancel: false,
      },
    ],
    slots: [
      {
        id: SLOT_ONE,
        doctor_name: "Dr Ada Okafor",
        specialty: "Cardiology",
        start_at: hours(72),
        end_at: hours(72.5),
      },
      {
        id: "slot-2",
        doctor_name: "Dr Ada Okafor",
        specialty: "Cardiology",
        start_at: hours(96),
        end_at: hours(96.5),
      },
      {
        id: "slot-3",
        doctor_name: "Dr Chidi Eze",
        specialty: "General practice",
        start_at: hours(50),
        end_at: hours(50.5),
      },
    ],
    results: [
      {
        id: RESULT_LOW,
        kind: "lab",
        name: "Haemoglobin",
        taken_at: hours(-20),
        ordered_by: "Dr Ada Okafor",
        seen: false,
        flag: "low",
        value: "10.2",
        unit: "g/dL",
        low: 12,
        high: 16,
        note: "",
      },
      {
        id: RESULT_NORMAL,
        kind: "lab",
        name: "Malaria parasite",
        taken_at: hours(-100),
        ordered_by: "Dr Bola Adeyemi",
        seen: true,
        flag: "normal",
        value: "Not seen",
        unit: "",
        low: null,
        high: null,
        note: "",
      },
      {
        id: RESULT_SCAN,
        kind: "imaging",
        name: "Chest X-ray",
        taken_at: hours(-30),
        ordered_by: "Dr Ada Okafor",
        seen: false,
        flag: "normal",
        value: "",
        unit: "",
        low: null,
        high: null,
        note: "Your lungs and heart look as expected. No sign of infection.",
      },
    ],
    prescriptions: [
      {
        id: "rx-1",
        prescribed_at: hours(-20),
        doctor_name: "Dr Ada Okafor",
        active: true,
        items: [
          {
            id: "rxi-1",
            drug_name: "Amoxicillin 500 mg",
            dose: "1 capsule",
            frequency: "TDS",
            route: "oral",
            duration_days: 5,
            quantity: 15,
            instructions: "Finish the course even if you feel better.",
          },
        ],
      },
      {
        id: "rx-2",
        prescribed_at: hours(-900),
        doctor_name: "Dr Bola Adeyemi",
        active: false,
        items: [
          {
            id: "rxi-2",
            drug_name: "Paracetamol 500 mg",
            dose: "2 tablets",
            frequency: "PRN",
            route: "oral",
            duration_days: 3,
            quantity: 12,
            instructions: "",
          },
        ],
      },
    ],
    invoices: [
      {
        id: INVOICE_DUE,
        reference: "INV-1A5E2F8C",
        created_at: hours(-20),
        currency: "NGN",
        total_minor: 1_250_000,
        paid_minor: 250_000,
        due_minor: 1_000_000,
        status: "partially_paid",
        lines: [
          { description: "Consultation", amount_minor: 500_000 },
          { description: "Chest X-ray", amount_minor: 750_000 },
        ],
      },
      {
        id: INVOICE_PAID,
        reference: "INV-3A5E2F8C",
        created_at: hours(-300),
        currency: "NGN",
        total_minor: 500_000,
        paid_minor: 500_000,
        due_minor: 0,
        status: "paid",
        lines: [{ description: "Consultation", amount_minor: 500_000 }],
      },
    ],
    profile: {
      first_name: "Chioma",
      last_name: "Nwosu",
      mrn: "2026-000207",
      date_of_birth: "1991-04-12",
      phone: "+2348035550123",
      email: "chioma@example.test",
      consents,
    },
    calls: [],
    next: 10,
    forbidden: false,
  };
}

export const portal: State = seeded();

export function resetPortalMocks(): void {
  Object.assign(portal, seeded());
}

const failure = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, details: {} } }, { status });

function refusal() {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  return portal.forbidden || !me.roles.includes("patient")
    ? failure(403, "permission_denied", "You do not have permission.")
    : null;
}

const upcoming = () =>
  portal.appointments
    .filter(
      (a) => ["booked", "confirmed"].includes(a.status) && Date.parse(a.start_at) > Date.now(),
    )
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));

export const portalHandlers = [
  http.get("*/api/portal/home/", () => {
    const refused = refusal();
    if (refused) return refused;
    return HttpResponse.json({
      first_name: portal.profile.first_name,
      next_appointment: upcoming()[0] ?? null,
      new_results: portal.results.filter((r) => !r.seen).length,
      balance_minor: portal.invoices.reduce((sum, i) => sum + i.due_minor, 0),
      currency: "NGN",
    } satisfies PortalHome);
  }),

  http.get("*/api/portal/appointments/", () => refusal() ?? HttpResponse.json(portal.appointments)),

  http.get("*/api/portal/appointment-slots/", () => refusal() ?? HttpResponse.json(portal.slots)),

  http.post("*/api/portal/appointments/", async ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const body = (await request.json()) as { slot: string; reason: string };
    portal.calls.push({ path: "book", body });
    const slot = portal.slots.find((s) => s.id === body.slot);
    if (!slot) return failure(409, "slot_taken", "That time has just been taken. Choose another.");
    portal.slots = portal.slots.filter((s) => s.id !== slot.id);
    const created: PortalAppointment = {
      id: `pa-new-${portal.next++}`,
      doctor_name: slot.doctor_name,
      specialty: slot.specialty,
      location: "Main hospital, Outpatient",
      start_at: slot.start_at,
      end_at: slot.end_at,
      status: "booked",
      reason: body.reason,
      can_cancel: true,
    };
    portal.appointments.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.post("*/api/portal/appointments/:id/cancel/", async ({ params, request }) => {
    const refused = refusal();
    if (refused) return refused;
    const body = (await request.json()) as { reason: string };
    portal.calls.push({ path: "cancel", body });
    const found = portal.appointments.find((a) => a.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    if (!found.can_cancel) {
      return failure(
        409,
        "cancel_refused",
        "This visit can no longer be cancelled online. Please call us.",
      );
    }
    if (body.reason.trim().length < 3) {
      return failure(400, "validation_error", "Tell us why you are cancelling.");
    }
    found.status = "cancelled";
    found.can_cancel = false;
    return HttpResponse.json(found);
  }),

  http.get("*/api/portal/results/", () => refusal() ?? HttpResponse.json(portal.results)),

  http.post("*/api/portal/results/:id/seen/", ({ params }) => {
    const refused = refusal();
    if (refused) return refused;
    const found = portal.results.find((r) => r.id === params.id);
    if (!found) return failure(404, "not_found", "Not found.");
    found.seen = true;
    return HttpResponse.json(found);
  }),

  http.get(
    "*/api/portal/prescriptions/",
    () => refusal() ?? HttpResponse.json(portal.prescriptions),
  ),

  http.get("*/api/portal/invoices/", () => refusal() ?? HttpResponse.json(portal.invoices)),

  http.get("*/api/portal/profile/", () => refusal() ?? HttpResponse.json(portal.profile)),

  http.patch("*/api/portal/profile/", async ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const body = (await request.json()) as Partial<PortalProfile>;
    portal.calls.push({ path: "profile", body });
    if (body.phone !== undefined && !/^\+\d{8,15}$/.test(body.phone)) {
      return failure(
        400,
        "validation_error",
        "Enter the phone number with its country code, such as +2348031234567.",
      );
    }
    Object.assign(portal.profile, {
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.consents && { consents: { ...portal.profile.consents, ...body.consents } }),
    });
    return HttpResponse.json(portal.profile);
  }),
];
