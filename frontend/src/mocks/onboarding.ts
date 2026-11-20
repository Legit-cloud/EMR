import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

import { resetAuthMocks } from "./auth";

/**
 * Sign-up and onboarding, shaped like apps/onboarding (docs/adr/0027). The emailed code is
 * 123456. By default an organisation has no onboarding (404, like one set up by hand); call
 * `startOnboarding()` to give it the questions.
 */
export const SIGNUP_CODE = "123456";

type Profile = Schemas["Profile"];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DEPARTMENTS = ["Outpatient (OPD)", "Emergency", "Paediatrics", "Pharmacy"];
const MODULES = ["appointments", "billing", "pharmacy", "inpatient"];

let profile: Mutable<Profile> | null = null;
export const signups: { email: string; organisation_name: string }[] = [];
export const resends: string[] = [];
export let lastFinished = false;

export function startOnboarding(overrides: Partial<Profile> = {}) {
  lastFinished = false;
  profile = {
    facility_name: "Sunrise Clinic",
    facility_type: "",
    country: "NG",
    city: "",
    phone: "",
    staff_band: "",
    bed_band: "",
    departments: [],
    modules: [],
    heard_from: "",
    complete: false,
    organisation_name: "Sunrise Clinic",
    department_choices: DEPARTMENTS,
    module_choices: MODULES,
    ...overrides,
  };
}

export function resetOnboardingMocks() {
  profile = null;
  signups.length = 0;
  resends.length = 0;
  lastFinished = false;
}

const refuse = (code: string, message: string, status = 400, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

export const onboardingHandlers = [
  http.post("*/api/onboarding/signup/", async ({ request }) => {
    const body = (await request.json()) as Schemas["SignupRequest"];
    if (!body.accepted_terms) return refuse("signup_refused", "Accept the terms.");
    signups.push({ email: body.email, organisation_name: body.organisation_name });
    return HttpResponse.json({ email: body.email.toLowerCase() }, { status: 202 });
  }),
  http.post("*/api/onboarding/signup/resend/", async ({ request }) => {
    const body = (await request.json()) as Schemas["ResendRequest"];
    resends.push(body.email);
    return HttpResponse.json({ email: body.email }, { status: 202 });
  }),
  http.post("*/api/onboarding/signup/verify/", async ({ request }) => {
    const body = (await request.json()) as Schemas["VerifyRequest"];
    if (body.code !== SIGNUP_CODE) {
      return refuse("invalid_code", "That code is not valid. Request a new one.");
    }
    resetAuthMocks("bisi.finance");
    startOnboarding();
    return HttpResponse.json({ user_id: "8a5e2f8c-0000-4000-8000-000000000012" });
  }),
  http.get("*/api/onboarding/profile/current/", () =>
    profile
      ? HttpResponse.json(profile)
      : refuse("not_found", "This organisation has no onboarding to complete.", 404),
  ),
  http.post("*/api/onboarding/profile/save/", async ({ request }) => {
    if (!profile) return refuse("not_found", "Nothing to complete.", 404);
    Object.assign(profile, (await request.json()) as Partial<Profile>);
    return HttpResponse.json(profile);
  }),
  http.post("*/api/onboarding/profile/finish/", () => {
    if (!profile) return refuse("not_found", "Nothing to complete.", 404);
    if (!profile.facility_type || !profile.staff_band || !profile.phone) {
      return refuse("onboarding_incomplete", "Answer every required question before finishing.");
    }
    profile.complete = true;
    lastFinished = true;
    return HttpResponse.json(profile);
  }),
];
