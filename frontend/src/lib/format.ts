// Money lives in one place; these re-exports keep the older imports working.
export { compactMoney, formatMoney, toMajorText, toMinor } from "./money";

const LAGOS = "Africa/Lagos";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: LAGOS,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The Lagos calendar day of a timestamp, for example "14 Oct 2026". */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: LAGOS,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: LAGOS,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ageFrom(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

/** "34 yrs", or "7 mo" for a baby under one, so age is never shown as "0". */
export function ageLabel(isoDate: string, today = new Date()): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const months =
    (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m) - (today.getDate() < d ? 1 : 0);
  if (months < 12) return `${Math.max(0, months)} mo`;
  return `${Math.floor(months / 12)} yrs`;
}

export function humanise(value: string): string {
  return value.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosToday(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return now.toLocaleDateString("en-CA", { timeZone: LAGOS });
}
