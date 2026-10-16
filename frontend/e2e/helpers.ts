import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { APIRequestContext } from "@playwright/test";

export type Seed = {
  run: string;
  password: string;
  users: Record<"doctor" | "desk" | "billing" | "login" | "pharmacist", { username: string; totp_key: string }>;
  physician_id: string;
  patient: { id: string; name: string; mrn: string };
  queued_appointment_id: string;
  queued_patient: string;
  queued_patient_id: string;
  encounter_id: string;
  invoice_id: string;
  prescription_to_dispense_id: string;
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

/** RFC 6238 TOTP, matching django-otp's defaults (SHA-1, 30 s steps, 6 digits). */
export function totp(hexKey: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", Buffer.from(hexKey, "hex")).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
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
