import { readFileSync } from "node:fs";
import path from "node:path";

import type { APIRequestContext } from "@playwright/test";

export type Seed = {
  run: string;
  password: string;
  users: Record<
    | "doctor"
    | "desk"
    | "billing"
    | "login"
    | "pharmacist"
    | "admin"
    | "hr"
    | "compliance"
    | "portal",
    { username: string; email: string }
  >;
  physician_id: string;
  patient: { id: string; name: string; mrn: string };
  queued_appointment_id: string;
  queued_patient: string;
  queued_patient_id: string;
  encounter_id: string;
  invoice_id: string;
  prescription_to_dispense_id: string;
  uninsured_invoice_id: string;
  duplicate_review_id: string;
  booking_date: string;
};

/** Written by `manage.py seed_e2e` (a fresh synthetic tenant per run). */
export function loadSeed(): Seed {
  return JSON.parse(readFileSync(path.join(__dirname, ".seed.json"), "utf-8"));
}

export function authFile(role: string): string {
  return path.join(__dirname, ".auth", `${role}.json`);
}

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8026";

async function mailpit(pathAndQuery: string) {
  const response = await fetch(`${MAILPIT}${pathAndQuery}`);
  if (!response.ok) throw new Error(`Mailpit ${pathAndQuery}: ${response.status}`);
  return response.json();
}

/** IDs of the messages already sent to an address, to tell a new sign-in code from an old one. */
export async function mailIdsFor(email: string): Promise<Set<string>> {
  const found = await mailpit(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  return new Set((found.messages ?? []).map((m: { ID: string }) => m.ID));
}

/**
 * The 6-digit sign-in code in the newest email to an address that is not in `before`.
 * The worker delivers the email after the sign-in request returns, so this waits for it.
 */
export async function emailedCode(email: string, before: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = await mailpit(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const fresh = (found.messages ?? []).find((m: { ID: string }) => !before.has(m.ID));
    if (fresh) {
      const message = await mailpit(`/api/v1/message/${fresh.ID}`);
      const match = /code is (\d{6})/.exec(message.Text ?? "");
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign-in code arrived for ${email}`);
}

/** Letters only (names reject digits), derived from the run id so each run is unique. */
export function lettersFrom(run: string): string {
  return run
    .replace(/[^0-9a-f]/g, "")
    .slice(-6)
    .split("")
    .map((c) => "abcdefghijklmnop"[parseInt(c, 16)])
    .join("");
}

/** Send an unsafe API request with the CSRF header, from a signed-in request context. */
export async function apiPost(request: APIRequestContext, url: string, data: unknown) {
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
  return request.post(url, { data, headers: { "X-CSRFToken": csrf } });
}
