import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

/**
 * Sign-in, password recovery and break-glass, shaped like the real API (apps/accounts).
 * Every account signs in with its password and an emailed code (123456). Synthetic accounts
 * only:
 *
 *   ada.doctor / synthetic-password-1
 *   tunde.desk / synthetic-password-1
 *   bisi.finance / synthetic-password-1 (tenant admin)
 */
export const MOCK_PASSWORD = "synthetic-password-1";
export const MOCK_OTP = "123456";
export const MOCK_PATIENT_ID = "8a5e2f8c-0000-4000-8000-000000000001";

const TENANT = "8a5e2f8c-0000-4000-8000-0000000000aa";
const FACILITY = "8a5e2f8c-0000-4000-8000-0000000000bb";

export const MOCK_USERS: Record<string, Schemas["Me"]> = {
  "ada.doctor": {
    id: "8a5e2f8c-0000-4000-8000-000000000010",
    username: "ada.doctor",
    email: "ada.doctor@example.test",
    first_name: "Ada",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["doctor"],
    mfa_enabled: true,
    assignments: [
      {
        role: "doctor",
        facility: FACILITY,
        department: "8a5e2f8c-0000-4000-8000-0000000000cc",
      },
    ],
    on_duty: true,
    can_break_glass: true,
  },
  "bisi.finance": {
    id: "8a5e2f8c-0000-4000-8000-000000000012",
    username: "bisi.finance",
    email: "bisi.finance@example.test",
    first_name: "Bisi",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["tenant_admin"],
    mfa_enabled: true,
    assignments: [{ role: "tenant_admin", facility: null, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
  "ngozi.billing": {
    id: "8a5e2f8c-0000-4000-8000-000000000013",
    username: "ngozi.billing",
    email: "ngozi.billing@example.test",
    first_name: "Ngozi",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["billing_officer"],
    mfa_enabled: true,
    assignments: [{ role: "billing_officer", facility: null, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
  "pita.pharmacist": {
    id: "8a5e2f8c-0000-4000-8000-000000000014",
    username: "pita.pharmacist",
    email: "pita.pharmacist@example.test",
    first_name: "Pita",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["pharmacist"],
    mfa_enabled: true,
    assignments: [{ role: "pharmacist", facility: null, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
  "kemi.lab": {
    id: "8a5e2f8c-0000-4000-8000-000000000020",
    username: "kemi.lab",
    email: "kemi.lab@example.test",
    first_name: "Kemi",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["lab_technician"],
    mfa_enabled: true,
    assignments: [{ role: "lab_technician", facility: null, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
  "femi.finance": {
    id: "8a5e2f8c-0000-4000-8000-000000000015",
    username: "femi.finance",
    email: "femi.finance@example.test",
    first_name: "Femi",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["finance"],
    mfa_enabled: true,
    assignments: [{ role: "finance", facility: null, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
  "chioma.patient": {
    id: "8a5e2f8c-0000-4000-8000-000000000016",
    username: "chioma.patient",
    email: "chioma@example.test",
    first_name: "Chioma",
    last_name: "Nwosu",
    tenant: TENANT,
    roles: ["patient"],
    mfa_enabled: true,
    assignments: [{ role: "patient", facility: null, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
  "tunde.desk": {
    id: "8a5e2f8c-0000-4000-8000-000000000011",
    username: "tunde.desk",
    email: "tunde.desk@example.test",
    first_name: "Tunde",
    last_name: "Tester",
    tenant: TENANT,
    roles: ["front_desk"],
    mfa_enabled: true,
    assignments: [{ role: "front_desk", facility: FACILITY, department: null }],
    on_duty: false,
    can_break_glass: false,
  },
};

const error = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

/** Mutable mock state, reset between tests with resetAuthMocks(). */
const state: { user: string | null; grant: Schemas["BreakGlassGrant"] | null } = {
  user: null,
  grant: null,
};

/** The signed-in mock user, for other mock handlers. */
export function mockSignedIn(): Schemas["Me"] | null {
  return state.user ? MOCK_USERS[state.user] : null;
}

export function resetAuthMocks(user: string | null = null): void {
  state.user = user;
  state.grant = null;
}

export const authHandlers = [
  http.get("*/api/accounts/auth/csrf/", () => new HttpResponse(null, { status: 204 })),

  http.post("*/api/accounts/auth/login/", async ({ request }) => {
    const body = (await request.json()) as Schemas["LoginRequest"];
    const user = MOCK_USERS[body.username];
    if (!user || body.password !== MOCK_PASSWORD) {
      return error(401, "invalid_credentials", "Invalid credentials.");
    }
    if (!body.otp_token) return error(401, "mfa_required", "A one-time code is required.");
    if (body.otp_token !== MOCK_OTP) return error(401, "invalid_otp", "Invalid code.");
    state.user = body.username;
    return HttpResponse.json({ user_id: user.id });
  }),

  http.post("*/api/accounts/auth/logout/", () => {
    state.user = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/accounts/auth/me/", () =>
    state.user
      ? HttpResponse.json(MOCK_USERS[state.user])
      : error(401, "not_authenticated", "Authentication credentials were not provided."),
  ),

  http.post("*/api/accounts/auth/password-reset/", async ({ request }) => {
    const { email } = (await request.json()) as { email: string };
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
      return error(400, "validation_error", "Invalid input.", { email: ["Enter a valid email."] });
    }
    // The same answer whether or not the address has an account.
    return new HttpResponse(null, { status: 202 });
  }),

  http.post("*/api/accounts/auth/password-reset/confirm/", async ({ request }) => {
    const body = (await request.json()) as Schemas["PasswordResetConfirmRequest"];
    if (body.token !== "valid-token") return error(400, "invalid_token", "Invalid link.");
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/accounts/break-glass/patients/:id/", ({ params }) => {
    if (!state.user) return error(401, "not_authenticated", "Not signed in.");
    const user = MOCK_USERS[state.user];
    return HttpResponse.json({
      patient: String(params.id),
      hidden_records: true,
      can_break_glass: user.can_break_glass,
      grant: state.grant?.object_id === params.id ? state.grant : null,
    });
  }),

  http.post("*/api/accounts/break-glass/", async ({ request }) => {
    const body = (await request.json()) as Schemas["BreakGlassRequestRequest"];
    if (!state.user) return error(401, "not_authenticated", "Not signed in.");
    if (!MOCK_USERS[state.user].can_break_glass) {
      return error(403, "break_glass_refused", "Your role cannot use break-glass access.");
    }
    if (body.reason.trim().length < 15) {
      return error(400, "domain_error", "Give a fuller reason for break-glass access.", {
        reason: ["At least 15 characters."],
      });
    }
    const now = Date.now();
    state.grant = {
      id: "8a5e2f8c-0000-4000-8000-000000000099",
      user: MOCK_USERS[state.user].id,
      resource: body.resource,
      object_id: body.object_id,
      reason: body.reason,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 60 * 60_000).toISOString(),
      review_status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      review_note: "",
    };
    return HttpResponse.json(state.grant, { status: 201 });
  }),
];
