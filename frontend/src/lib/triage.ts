import type { TriageLevel } from "./status-map";

/**
 * The API stores triage priority from 1 (most urgent) to 5. The queue shows four levels
 * (docs/DESIGN.md): 1 is Emergency, 2 Urgent, 3 Routine, 4 and 5 Non-urgent. A patient who
 * has not been triaged has no level. This mapping is a proposal that the clinical lead must
 * approve (ADR 0015); it lives here so it can change in one place.
 */
export function triageLevel(priority: number | null | undefined): TriageLevel | null {
  if (priority == null) return null;
  if (priority <= 1) return "emergency";
  if (priority === 2) return "urgent";
  if (priority === 3) return "routine";
  return "non_urgent";
}

export type WaitTone = "normal" | "long" | "very_long";

export type WaitThresholds = { longMinutes: number; veryLongMinutes: number };

const fromEnv = (value: string | undefined, fallback: number) => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallback;
};

/**
 * Minutes of waiting after which the chip turns amber, then pink. Set per deployment with
 * NEXT_PUBLIC_QUEUE_LONG_WAIT_MINUTES and NEXT_PUBLIC_QUEUE_VERY_LONG_WAIT_MINUTES; a
 * per-clinic setting needs a tenant settings API, which does not exist yet.
 */
export const WAIT_THRESHOLDS: WaitThresholds = {
  longMinutes: fromEnv(process.env.NEXT_PUBLIC_QUEUE_LONG_WAIT_MINUTES, 15),
  veryLongMinutes: fromEnv(process.env.NEXT_PUBLIC_QUEUE_VERY_LONG_WAIT_MINUTES, 30),
};

/** Whole minutes from arrival to `now`, never negative (clocks differ by a little). */
export function waitMinutes(checkedInAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(checkedInAt)) / 60_000));
}

export function waitTone(minutes: number, thresholds: WaitThresholds = WAIT_THRESHOLDS): WaitTone {
  if (minutes >= thresholds.veryLongMinutes) return "very_long";
  if (minutes >= thresholds.longMinutes) return "long";
  return "normal";
}

/** "8 min", "1 h 05 min". */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
