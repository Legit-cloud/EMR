import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

/** Inviting people, shaped like apps/accounts (docs/adr/0028). Synthetic data. */
type RoleInfo = Schemas["RoleInfo"];

export const ROLE_CATALOGUE: RoleInfo[] = [
  {
    role: "doctor",
    label: "Doctor",
    description: "Sees patients, records vitals, diagnoses and notes, and prescribes.",
    permissions: [
      {
        resource: "patients.patient",
        label: "Patient records",
        actions: ["View", "Add", "Change"],
        limit: "",
        on_duty_only: false,
      },
      {
        resource: "pharmacy.prescription",
        label: "Prescriptions",
        actions: ["View", "Add", "Change"],
        limit: "for patients in their care",
        on_duty_only: false,
      },
    ],
  },
  {
    role: "nurse",
    label: "Nurse",
    description: "Cares for patients: vitals, bed management, and day-to-day supplies.",
    permissions: [
      {
        resource: "clinical.vitalsigns",
        label: "Vital signs",
        actions: ["View", "Add"],
        limit: "for patients in their care",
        on_duty_only: true,
      },
    ],
  },
  {
    role: "compliance_officer",
    label: "Compliance officer",
    description: "Reviews the audit log and break-glass access. Cannot change records.",
    permissions: [
      {
        resource: "audit.auditentry",
        label: "Audit log",
        actions: ["View"],
        limit: "",
        on_duty_only: false,
      },
    ],
  },
];

export const invited: Schemas["UserRequest"][] = [];
export const resetPeopleMocks = () => {
  invited.length = 0;
};

const page = <T>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

const PEOPLE = [
  {
    id: "u1",
    username: "ada@sunrise.example.test",
    email: "ada@sunrise.example.test",
    first_name: "Ada",
    last_name: "Obi",
    is_active: true,
  },
  {
    id: "u2",
    username: "bola@sunrise.example.test",
    email: "bola@sunrise.example.test",
    first_name: "Bola",
    last_name: "Adeyemi",
    is_active: true,
  },
];

export const peopleHandlers = [
  http.get("*/api/accounts/users/", () => HttpResponse.json(page(PEOPLE))),
  http.get("*/api/accounts/role-assignments/", () =>
    HttpResponse.json(
      page([
        { id: "r1", user: "u1", role: "tenant_admin", facility: null, department: null },
        { id: "r2", user: "u2", role: "nurse", facility: null, department: null },
      ]),
    ),
  ),
  http.get("*/api/accounts/users/roles/", () => HttpResponse.json(ROLE_CATALOGUE)),
  http.post("*/api/accounts/users/", async ({ request }) => {
    const body = (await request.json()) as Schemas["UserRequest"];
    if (body.email.toLowerCase() === "taken@example.test") {
      return HttpResponse.json(
        {
          error: {
            code: "validation_error",
            message: "Check the form.",
            details: { email: ["That email address already belongs to another account."] },
          },
        },
        { status: 400 },
      );
    }
    invited.push(body);
    return HttpResponse.json(
      { id: "new-user", username: body.email, is_active: true, ...body },
      { status: 201 },
    );
  }),
];
