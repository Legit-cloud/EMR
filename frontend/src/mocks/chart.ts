import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

import { mockSignedIn } from "./auth";

/**
 * A patient chart, shaped like apps/patients, apps/clinical, apps/pharmacy and apps/billing,
 * with the rules the server enforces that the screens rely on (a resolved diagnosis needs a
 * date, implausible readings are refused, closed notes lock). Synthetic data only.
 */
export const CHART_PATIENT = "8a5e2f8c-0000-4000-8000-0000000004aa";
export const OPEN_VISIT = "8a5e2f8c-0000-4000-8000-0000000004e1";
const DOCTOR = "8a5e2f8c-0000-4000-8000-000000000010";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

type State = {
  patient: Schemas["Patient"];
  encounters: Schemas["Encounter"][];
  vitals: Schemas["VitalSigns"][];
  diagnoses: Schemas["Diagnosis"][];
  notes: Schemas["ConsultationNote"][];
  allergies: Schemas["Allergy"][];
  /** Endpoint groups that answer 403, for no-access states: "vitals", "notes", ... */
  forbidden: Set<string>;
  /** Requests received, for assertions. */
  calls: { path: string; body: unknown }[];
  next: number;
};

const OBS = (code: string, display: string, value: string, unit: string) => ({
  code,
  display,
  value,
  unit,
});

function vitalSet(
  id: string,
  hours: number,
  readings: [string, string, string, string][],
): Schemas["VitalSigns"] {
  return {
    id,
    patient: CHART_PATIENT,
    encounter: OPEN_VISIT,
    recorded_at: hoursAgo(hours),
    recorded_by: DOCTOR,
    observations: readings.map(([code, display, value, unit]) => OBS(code, display, value, unit)),
    record_state: "active",
    created_at: hoursAgo(hours),
  };
}

function fresh(): State {
  return {
    patient: {
      id: CHART_PATIENT,
      mrn: "2026-000301",
      first_name: "Ngozi",
      middle_name: "",
      last_name: "Eze",
      date_of_birth: "1985-06-01",
      sex: "female",
      national_id: "",
      phone: "+2348031234567",
      email: "",
      address_line: "",
      city: "",
      state: "",
      country: "NG",
      status: "active",
      deceased_at: null,
      record_state: "active",
      created_at: hoursAgo(500),
    },
    encounters: [
      {
        id: "8a5e2f8c-0000-4000-8000-0000000004e0",
        patient: CHART_PATIENT,
        encounter_class: "outpatient",
        status: "finished",
        facility: "8a5e2f8c-0000-4000-8000-0000000000bb",
        started_at: hoursAgo(200),
        ended_at: hoursAgo(199),
        reason: "Antenatal visit",
        record_state: "active",
      },
    ],
    vitals: [
      vitalSet("v2", 2, [
        ["8480-6", "Systolic blood pressure", "150", "mm[Hg]"],
        ["8462-4", "Diastolic blood pressure", "95", "mm[Hg]"],
        ["8867-4", "Heart rate", "112", "/min"],
        ["8310-5", "Body temperature", "36.8", "Cel"],
        ["59408-5", "Oxygen saturation by pulse oximetry", "98", "%"],
        ["39156-5", "Body mass index", "24.2", "kg/m2"],
      ]),
      vitalSet("v1", 200, [
        ["8480-6", "Systolic blood pressure", "144", "mm[Hg]"],
        ["8462-4", "Diastolic blood pressure", "88", "mm[Hg]"],
        ["8867-4", "Heart rate", "88", "/min"],
        ["8310-5", "Body temperature", "36.6", "Cel"],
        ["59408-5", "Oxygen saturation by pulse oximetry", "99", "%"],
        ["39156-5", "Body mass index", "24.0", "kg/m2"],
      ]),
    ],
    diagnoses: [
      {
        id: "d1",
        patient: CHART_PATIENT,
        encounter: OPEN_VISIT,
        code_system: "icd10",
        code: "O13",
        display: "Gestational hypertension",
        clinical_status: "active",
        verification_status: "confirmed",
        onset_date: "2026-08-01",
        abatement_date: null,
        recorded_by: DOCTOR,
        record_state: "active",
        created_at: hoursAgo(200),
      },
    ],
    notes: [],
    allergies: [
      {
        id: "a1",
        patient: CHART_PATIENT,
        substance: "Penicillin",
        category: "medication",
        reaction: "Hives",
        severity: "severe",
        record_state: "active",
        created_at: hoursAgo(300),
      },
    ],
    forbidden: new Set(),
    calls: [],
    next: 100,
  };
}

export const chart: State = fresh();

/** Reset between tests; `visit: true` leaves a visit in progress. */
export function resetChartMocks(options: { visit?: boolean } = {}): void {
  Object.assign(chart, fresh());
  if (options.visit) {
    chart.encounters.unshift({
      id: OPEN_VISIT,
      patient: CHART_PATIENT,
      encounter_class: "outpatient",
      status: "in_progress",
      facility: "8a5e2f8c-0000-4000-8000-0000000000bb",
      started_at: hoursAgo(1),
      ended_at: null,
      reason: "Headache",
      record_state: "active",
    });
  }
}

const failure = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const page = <T>(results: T[]) =>
  HttpResponse.json({ count: results.length, next: null, previous: null, results });

const denied = () => failure(403, "permission_denied", "You do not have permission.");

const ICD10 = [
  { code: "B54", display: "Unspecified malaria" },
  { code: "B50.9", display: "Plasmodium falciparum malaria, unspecified" },
  { code: "I10", display: "Essential (primary) hypertension" },
];

const LOINC: Schemas["LoincCode"][] = [
  {
    code: "8480-6",
    display: "Systolic blood pressure",
    unit: "mm[Hg]",
    min_value: "40",
    max_value: "300",
  },
  {
    code: "8462-4",
    display: "Diastolic blood pressure",
    unit: "mm[Hg]",
    min_value: "20",
    max_value: "200",
  },
  { code: "8867-4", display: "Heart rate", unit: "/min", min_value: "20", max_value: "300" },
  { code: "8310-5", display: "Body temperature", unit: "Cel", min_value: "30", max_value: "45" },
  { code: "29463-7", display: "Body weight", unit: "kg", min_value: "0.3", max_value: "400" },
  { code: "8302-2", display: "Body height", unit: "cm", min_value: "20", max_value: "260" },
  {
    code: "39156-5",
    display: "Body mass index",
    unit: "kg/m2",
    min_value: "5",
    max_value: "150",
    derived: true,
  },
];

function record(path: string, body: unknown) {
  chart.calls.push({ path, body });
}

function hide<T extends { id: string; record_state: string }>(rows: T[], id: string) {
  const row = rows.find((r) => r.id === id);
  if (row) row.record_state = "entered_in_error";
}

const visible = <T extends { record_state: string }>(rows: T[]) =>
  rows.filter((r) => r.record_state === "active");

export const chartHandlers = [
  http.get("*/api/patients/patients/:id/", ({ params }) => {
    if (!mockSignedIn()) return failure(401, "not_authenticated", "Not signed in.");
    if (params.id !== CHART_PATIENT) return failure(404, "not_found", "Not found.");
    return chart.forbidden.has("patient") ? denied() : HttpResponse.json(chart.patient);
  }),

  // -- lists -------------------------------------------------------------------------
  http.get("*/api/patients/allergies/", () =>
    chart.forbidden.has("allergies") ? denied() : page(visible(chart.allergies)),
  ),
  http.get("*/api/clinical/encounters/", () =>
    chart.forbidden.has("encounters") ? denied() : page(chart.encounters),
  ),
  http.get("*/api/clinical/vitals/", () =>
    chart.forbidden.has("vitals") ? denied() : page(visible(chart.vitals)),
  ),
  http.get("*/api/clinical/diagnoses/", () =>
    chart.forbidden.has("diagnoses") ? denied() : page(visible(chart.diagnoses)),
  ),
  http.get("*/api/clinical/notes/", () =>
    chart.forbidden.has("notes") ? denied() : page(visible(chart.notes)),
  ),
  http.get("*/api/patients/attachments/", () =>
    chart.forbidden.has("attachments") ? denied() : page<Schemas["Attachment"]>([]),
  ),
  http.get("*/api/audit/entries/", () =>
    chart.forbidden.has("audit")
      ? denied()
      : page<Schemas["AuditEntry"]>([
          {
            id: "au1",
            sequence: 1,
            occurred_at: hoursAgo(1),
            actor_id: DOCTOR,
            actor_label: "Doctor Tester",
            action: "read",
            outcome: "allowed",
            resource: "patients.patient",
            object_id: CHART_PATIENT,
            reason: "",
            ip_address: null,
            user_agent: "",
            method: "GET",
            path: "",
            details: {},
            entry_hash: "h",
          },
        ]),
  ),

  // -- reference data ----------------------------------------------------------------
  http.get("*/api/clinical/codes/loinc/", () => HttpResponse.json(LOINC)),
  http.get("*/api/clinical/codes/icd10/", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    return page(
      ICD10.filter(
        (c) => !q || c.code.toLowerCase().startsWith(q) || c.display.toLowerCase().includes(q),
      ),
    );
  }),
  http.get("*/api/tenants/facilities/", () =>
    page([{ id: "8a5e2f8c-0000-4000-8000-0000000000bb", name: "Main Clinic", code: "MAIN" }]),
  ),
  http.get("*/api/tenants/departments/", () =>
    page([
      {
        id: "8a5e2f8c-0000-4000-8000-0000000000cc",
        name: "Medicine",
        facility: "8a5e2f8c-0000-4000-8000-0000000000bb",
      },
    ]),
  ),

  // -- vitals ------------------------------------------------------------------------
  http.post("*/api/clinical/vitals/", async ({ request }) => {
    const body = (await request.json()) as {
      encounter: string;
      readings: { code: string; value: string }[];
    };
    record("vitals", body);
    const problems: string[] = [];
    const observations = body.readings.map(({ code, value }) => {
      const spec = LOINC.find((c) => c.code === code)!;
      if (Number(value) < Number(spec.min_value) || Number(value) > Number(spec.max_value)) {
        problems.push(
          `${spec.display} ${value} is outside ${spec.min_value} to ${spec.max_value} ${spec.unit}.`,
        );
      }
      return OBS(code, spec.display, value, spec.unit);
    });
    if (problems.length)
      return failure(400, "validation_error", "Invalid input.", { readings: problems });
    const weight = body.readings.find((r) => r.code === "29463-7");
    const height = body.readings.find((r) => r.code === "8302-2");
    if (weight && height) {
      const m = Number(height.value) / 100;
      observations.push(
        OBS("39156-5", "Body mass index", (Number(weight.value) / (m * m)).toFixed(2), "kg/m2"),
      );
    }
    const created = { ...vitalSet(`v${chart.next++}`, 0, []), observations };
    chart.vitals.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post("*/api/clinical/vitals/:id/entered-in-error/", async ({ params, request }) => {
    record(`vitals/${String(params.id)}/entered-in-error`, await request.json());
    hide(chart.vitals, String(params.id));
    return HttpResponse.json({});
  }),

  // -- diagnoses ---------------------------------------------------------------------
  http.post("*/api/clinical/diagnoses/", async ({ request }) => {
    const body = (await request.json()) as Schemas["DiagnosisRequest"];
    record("diagnoses", body);
    if (body.clinical_status === "resolved" && !body.abatement_date) {
      return failure(400, "validation_error", "Invalid input.", {
        abatement_date: ["A resolved diagnosis needs the date it resolved."],
      });
    }
    const found = ICD10.find((c) => c.code === body.code);
    const created: Schemas["Diagnosis"] = {
      id: `d${chart.next++}`,
      patient: CHART_PATIENT,
      encounter: body.encounter,
      code_system: "icd10",
      code: body.code,
      display: found?.display ?? body.code,
      clinical_status: body.clinical_status ?? "active",
      verification_status: body.verification_status ?? "unconfirmed",
      onset_date: body.onset_date ?? null,
      abatement_date: body.abatement_date ?? null,
      recorded_by: DOCTOR,
      record_state: "active",
      created_at: new Date().toISOString(),
    };
    chart.diagnoses.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch("*/api/clinical/diagnoses/:id/", async ({ params, request }) => {
    const body = (await request.json()) as Schemas["PatchedDiagnosisRequest"];
    record(`diagnoses/${String(params.id)}`, body);
    const row = chart.diagnoses.find((d) => d.id === params.id)!;
    if (row.clinical_status === "resolved" && body.clinical_status === "active") {
      return failure(400, "validation_error", "Invalid input.", {
        clinical_status: ["A resolved diagnosis can only come back as a recurrence."],
      });
    }
    if (body.clinical_status === "resolved" && !body.abatement_date) {
      return failure(400, "validation_error", "Invalid input.", {
        abatement_date: ["A resolved diagnosis needs the date it resolved."],
      });
    }
    Object.assign(row, body);
    return HttpResponse.json(row);
  }),
  http.post("*/api/clinical/diagnoses/:id/entered-in-error/", async ({ params, request }) => {
    record(`diagnoses/${String(params.id)}/entered-in-error`, await request.json());
    hide(chart.diagnoses, String(params.id));
    return HttpResponse.json({});
  }),

  // -- notes -------------------------------------------------------------------------
  http.post("*/api/clinical/notes/", async ({ request }) => {
    const body = (await request.json()) as Schemas["ConsultationNoteRequest"];
    record("notes", body);
    const created: Schemas["ConsultationNote"] = {
      id: `n${chart.next++}`,
      patient: CHART_PATIENT,
      encounter: body.encounter,
      subjective: body.subjective ?? "",
      objective: body.objective ?? "",
      assessment: body.assessment ?? "",
      plan: body.plan ?? "",
      status: "open",
      closed_at: null,
      addendum_to: body.addendum_to ?? null,
      author: DOCTOR,
      record_state: "active",
      created_at: new Date().toISOString(),
    };
    chart.notes.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch("*/api/clinical/notes/:id/", async ({ params, request }) => {
    const row = chart.notes.find((n) => n.id === params.id)!;
    if (row.status === "closed")
      return failure(400, "domain_error", "A closed note cannot be edited.");
    Object.assign(row, await request.json());
    return HttpResponse.json(row);
  }),
  http.post("*/api/clinical/notes/:id/close/", ({ params }) => {
    record(`notes/${String(params.id)}/close`, null);
    const row = chart.notes.find((n) => n.id === params.id)!;
    Object.assign(row, { status: "closed", closed_at: new Date().toISOString() });
    return HttpResponse.json(row);
  }),
  http.post("*/api/clinical/notes/:id/entered-in-error/", async ({ params, request }) => {
    record(`notes/${String(params.id)}/entered-in-error`, await request.json());
    hide(chart.notes, String(params.id));
    return HttpResponse.json({});
  }),

  // -- allergies ---------------------------------------------------------------------
  http.post("*/api/patients/allergies/", async ({ request }) => {
    const body = (await request.json()) as Schemas["AllergyRequest"];
    record("allergies", body);
    const created: Schemas["Allergy"] = {
      id: `a${chart.next++}`,
      patient: CHART_PATIENT,
      substance: body.substance,
      category: body.category,
      reaction: body.reaction,
      severity: body.severity,
      record_state: "active",
      created_at: new Date().toISOString(),
    };
    chart.allergies.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post("*/api/patients/allergies/:id/entered-in-error/", async ({ params, request }) => {
    record(`allergies/${String(params.id)}/entered-in-error`, await request.json());
    hide(chart.allergies, String(params.id));
    return HttpResponse.json({});
  }),

  // -- visits ------------------------------------------------------------------------
  http.post("*/api/clinical/encounters/", async ({ request }) => {
    const body = (await request.json()) as Schemas["EncounterRequest"];
    record("encounters", body);
    const created: Schemas["Encounter"] = {
      id: OPEN_VISIT,
      patient: CHART_PATIENT,
      encounter_class: body.encounter_class,
      status: "in_progress",
      facility: body.facility,
      department: body.department ?? null,
      started_at: new Date().toISOString(),
      ended_at: null,
      reason: body.reason ?? "",
      record_state: "active",
    };
    chart.encounters.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post("*/api/clinical/encounters/:id/status/", async ({ params, request }) => {
    const body = (await request.json()) as { status: Schemas["EncounterStatusEnum"] };
    record(`encounters/${String(params.id)}/status`, body);
    const row = chart.encounters.find((e) => e.id === params.id)!;
    Object.assign(row, { status: body.status, ended_at: new Date().toISOString() });
    return HttpResponse.json(row);
  }),
];
