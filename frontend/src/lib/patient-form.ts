import { z } from "zod";

import type { Schemas } from "./api";
import { COUNTRIES, DEFAULT_COUNTRY } from "./countries";
import { lagosToday } from "./format";

/**
 * The registration form's rules, mirroring the API's (apps/patients). The API decides: this
 * is for early, kind feedback, not for security.
 */

const APOSTROPHES: Record<string, string> = { "’": "'", "‘": "'", ʼ: "'" };

/** NFC-normalise, unify apostrophes and collapse whitespace (apps/patients/normalize.py). */
export function cleanName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[’‘ʼ]/g, (c) => APOSTROPHES[c])
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Letters (accents included), separated by single spaces, hyphens or apostrophes. */
const NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+)*$/u;
const NAME_MESSAGE = "Use letters only, separated by single spaces, hyphens or apostrophes.";
const E164 = /^\+[1-9]\d{6,14}$/;
const MIN_YEAR = 1880;

const requiredName = (label: string) =>
  z
    .string()
    .refine((v) => cleanName(v).length > 0, `${label} is required.`)
    .refine((v) => cleanName(v).length === 0 || NAME_PATTERN.test(cleanName(v)), NAME_MESSAGE)
    .refine((v) => cleanName(v).length <= 100, "Use 100 characters or fewer.");

const optionalName = z
  .string()
  .refine((v) => cleanName(v).length === 0 || NAME_PATTERN.test(cleanName(v)), NAME_MESSAGE)
  .refine((v) => cleanName(v).length <= 100, "Use 100 characters or fewer.");

export const SEX_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Whether "YYYY-MM-DD" is a real calendar date. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const identitySchema = z.object({
  first_name: requiredName("First name"),
  middle_name: optionalName,
  last_name: requiredName("Last name"),
  date_of_birth: z
    .string()
    .min(1, "Date of birth is required.")
    .refine((v) => v === "" || isRealDate(v), "Enter a valid date.")
    .refine((v) => !isRealDate(v) || v <= lagosToday(), "Date of birth cannot be in the future.")
    .refine(
      (v) => !isRealDate(v) || Number(v.slice(0, 4)) >= MIN_YEAR,
      "Date of birth is too far in the past.",
    ),
  sex: z.enum(["female", "male", "other", "unknown"]),
  national_id: z
    .string()
    .max(32, "Use 32 characters or fewer.")
    .regex(/^[A-Za-z0-9 -]*$/, "Use letters and numbers only."),
});

/** Strip separators; a leading + or 00 means the number already has its country code. */
export function buildPhone(dialCode: string, local: string): string {
  const raw = local.replace(/[\s\-().]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;
  return `+${dialCode}${raw.replace(/^0+/, "")}`;
}

export const contactSchema = z
  .object({
    phone_country: z.string(),
    phone_local: z.string(),
    email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
    address_line: z.string().max(200, "Use 200 characters or fewer."),
    city: z.string().max(100, "Use 100 characters or fewer."),
    state: z.string().max(100, "Use 100 characters or fewer."),
    country: z.string(),
  })
  .superRefine((value, ctx) => {
    const dial = COUNTRIES.find((c) => c.iso === value.phone_country)?.dial ?? "234";
    const phone = buildPhone(dial, value.phone_local);
    if (phone && !E164.test(phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["phone_local"],
        message: "Enter a phone number, for example 0803 123 4567.",
      });
    }
  });

export const ALLERGY_CATEGORIES = [
  { value: "medication", label: "Medicine" },
  { value: "food", label: "Food" },
  { value: "environment", label: "Environment" },
  { value: "biologic", label: "Biologic" },
] as const;

export const ALLERGY_SEVERITIES = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

export const allergySchema = z.object({
  substance: z
    .string()
    .refine((v) => v.trim().length > 0, "Name the substance.")
    .refine((v) => v.length <= 200, "Use 200 characters or fewer."),
  category: z.enum(["medication", "food", "environment", "biologic"]),
  reaction: z
    .string()
    .refine((v) => v.trim().length > 0, "Describe the reaction.")
    .refine((v) => v.length <= 500, "Use 500 characters or fewer."),
  severity: z.enum(["mild", "moderate", "severe"]),
});

export const registrationSchema = identitySchema
  .and(contactSchema)
  .and(z.object({ allergies: z.array(allergySchema) }));

export type RegistrationValues = z.infer<typeof registrationSchema>;

export const EMPTY_REGISTRATION: RegistrationValues = {
  first_name: "",
  middle_name: "",
  last_name: "",
  date_of_birth: "",
  sex: "unknown",
  national_id: "",
  phone_country: DEFAULT_COUNTRY,
  phone_local: "",
  email: "",
  address_line: "",
  city: "",
  state: "",
  country: DEFAULT_COUNTRY,
  allergies: [],
};

export const EMPTY_ALLERGY: RegistrationValues["allergies"][number] = {
  substance: "",
  category: "medication",
  reaction: "",
  severity: "moderate",
};

/** The form fields on each step, so Next can validate just that step. */
export const STEP_FIELDS = [
  ["first_name", "middle_name", "last_name", "date_of_birth", "sex", "national_id"],
  ["phone_country", "phone_local", "email", "address_line", "city", "state", "country"],
  ["allergies"],
] as const;

/** Whether the identity fields are complete and valid enough to look for duplicates. */
export function canCheckDuplicates(
  values: Pick<RegistrationValues, "first_name" | "last_name" | "date_of_birth">,
) {
  return (
    requiredName("x").safeParse(values.first_name).success &&
    requiredName("x").safeParse(values.last_name).success &&
    identitySchema.shape.date_of_birth.safeParse(values.date_of_birth).success
  );
}

/** The API's registration body, from the form. */
export function toRegistrationBody(
  values: RegistrationValues,
): Schemas["PatientRegistrationRequest"] {
  const dial = COUNTRIES.find((c) => c.iso === values.phone_country)?.dial ?? "234";
  return {
    first_name: cleanName(values.first_name),
    middle_name: cleanName(values.middle_name),
    last_name: cleanName(values.last_name),
    date_of_birth: values.date_of_birth,
    sex: values.sex,
    national_id: values.national_id.trim(),
    phone: buildPhone(dial, values.phone_local),
    email: values.email.trim(),
    address_line: values.address_line.trim(),
    city: values.city.trim(),
    state: values.state.trim(),
    country: values.country,
    allergies: values.allergies.map((a) => ({
      substance: a.substance.trim(),
      category: a.category,
      reaction: a.reaction.trim(),
      severity: a.severity,
    })),
  };
}
