import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, ensureCsrfCookie, type Schemas, unwrap } from "@/lib/api";

/**
 * Self-service sign-up and the onboarding questions (apps/onboarding, docs/adr/0027).
 * Sign up, confirm the email with a code, answer a few questions, then the dashboard.
 */
export type Profile = Schemas["Profile"];
export type Answers = Schemas["AnswersRequest"];
export type SignupBody = Schemas["SignupRequest"];

export const FACILITY_TYPES = [
  { value: "clinic", label: "Clinic", description: "Outpatient care, one site" },
  { value: "hospital", label: "Hospital", description: "Outpatient and inpatient care" },
  { value: "specialist_centre", label: "Specialist centre", description: "One speciality" },
  { value: "group", label: "Group of facilities", description: "Several sites" },
] as const;

export const STAFF_BANDS = [
  { value: "1-10", label: "1 to 10" },
  { value: "11-50", label: "11 to 50" },
  { value: "51-200", label: "51 to 200" },
  { value: "200+", label: "More than 200" },
];

export const BED_BANDS = [
  { value: "none", label: "No inpatient beds" },
  { value: "1-20", label: "1 to 20" },
  { value: "21-100", label: "21 to 100" },
  { value: "100+", label: "More than 100" },
];

export const MODULE_LABELS: Record<string, string> = {
  appointments: "Appointments and queue",
  patient_records: "Patient records",
  pharmacy: "Pharmacy and stock",
  inpatient: "Wards and beds",
  diagnostics: "Lab and imaging",
  billing: "Billing and payments",
  insurance_claims: "Insurer claims",
  patient_portal: "Patient portal",
  inventory: "Supplies",
  hr: "Staff and leave",
};

// -- checking what was typed -------------------------------------------------------------------

/** Nigerian numbers may be typed with a leading 0; everything is stored as +country code. */
export function toE164(text: string): string | null {
  const digits = text.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  return null;
}

/** The first problem with the password, or null. The server applies its own rules too. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (/^\d+$/.test(password)) return "Do not use only numbers.";
  return null;
}

export type SignupErrors = Partial<Record<keyof SignupBody | "confirm", string>>;

export function checkSignup(form: SignupBody & { confirm: string }): SignupErrors {
  const errors: SignupErrors = {};
  if (form.organisation_name.trim().length < 2) {
    errors.organisation_name = "Enter the name of your hospital or clinic.";
  }
  if (!form.first_name.trim()) errors.first_name = "Enter your first name.";
  if (!form.last_name.trim()) errors.last_name = "Enter your last name.";
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = "Enter a valid email address.";
  const weak = passwordProblem(form.password);
  if (weak) errors.password = weak;
  else if (form.confirm !== form.password) errors.confirm = "The passwords do not match.";
  if (!form.accepted_terms) errors.accepted_terms = "Accept the terms to continue.";
  return errors;
}

/** Whether the answers on the first three steps are enough to finish. */
export function missingAnswers(profile: Profile): string[] {
  const missing: string[] = [];
  if (!profile.facility_name?.trim()) missing.push("the name of the facility");
  if (!profile.facility_type) missing.push("the type of facility");
  if (!profile.phone?.trim()) missing.push("a phone number");
  if (!profile.staff_band) missing.push("the number of staff");
  return missing;
}

export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** A sentence for a refused sign-up step. */
export function signupMessage(failure: unknown): string {
  const problem = apiError(failure);
  if (problem.code === "validation_error") {
    const first = Object.values(problem.details)[0];
    return Array.isArray(first) ? String(first[0]) : problem.message;
  }
  if (problem.code === "throttled") return "Too many attempts. Wait a minute and try again.";
  return problem.message;
}

// -- requests ----------------------------------------------------------------------------------

export function useSignup() {
  return useMutation({
    mutationFn: async (body: SignupBody) => {
      await ensureCsrfCookie();
      return unwrap(api.POST("/api/onboarding/signup/", { body }));
    },
    meta: { quietErrors: true },
  });
}

export function useResendCode() {
  return useMutation({
    mutationFn: async (email: string) => {
      await ensureCsrfCookie();
      return unwrap(api.POST("/api/onboarding/signup/resend/", { body: { email } }));
    },
    meta: { quietErrors: true },
  });
}

export function useVerifySignup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { email: string; code: string }) => {
      await ensureCsrfCookie();
      return unwrap(api.POST("/api/onboarding/signup/verify/", { body }));
    },
    // Anything cached while signed out, such as "no session", is wrong now.
    onSuccess: () => client.clear(),
    meta: { quietErrors: true },
  });
}

/** The questions and answers. A 404 means this organisation has no onboarding to do. */
export function useOnboarding(enabled = true) {
  return useQuery({
    queryKey: ["onboarding", "current"],
    queryFn: () => unwrap(api.GET("/api/onboarding/profile/current/")),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useSaveAnswers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Answers) => unwrap(api.POST("/api/onboarding/profile/save/", { body })),
    onSuccess: (profile) => client.setQueryData(["onboarding", "current"], profile),
    meta: { quietErrors: true },
  });
}

export function useFinishOnboarding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/onboarding/profile/finish/")),
    onSuccess: (profile) => {
      client.setQueryData(["onboarding", "current"], profile);
      // The facility was renamed and departments made.
      client.invalidateQueries({ queryKey: ["facilities"] });
    },
    meta: { quietErrors: true },
  });
}
