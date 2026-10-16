const MINOR_DIGITS: Record<string, number> = { XOF: 0 };

/**
 * Money arrives as integer minor units. Format with integer arithmetic only, so a
 * displayed amount can never differ from the stored one by a rounding error.
 */
export function formatMoney(minor: number, currency: string): string {
  const digits = MINOR_DIGITS[currency] ?? 2;
  const negative = minor < 0;
  const units = BigInt(Math.abs(minor));
  const scale = 10n ** BigInt(digits);
  const whole = (units / scale).toLocaleString("en-NG");
  const fraction = digits ? `.${(units % scale).toString().padStart(digits, "0")}` : "";
  const symbol = currency === "NGN" ? "₦" : `${currency} `;
  return `${negative ? "-" : ""}${symbol}${whole}${fraction}`;
}

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

export function humanise(value: string): string {
  return value.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosToday(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return now.toLocaleDateString("en-CA", { timeZone: LAGOS });
}

/**
 * Parse a typed major-unit amount ("1,500.50") into integer minor units without floating
 * point. Returns null when it is not a valid amount for the currency.
 */
export function toMinor(text: string, currency = "NGN"): number | null {
  const digits = MINOR_DIGITS[currency] ?? 2;
  const clean = text.replaceAll(",", "").trim();
  const [whole, fraction = "", extra] = clean.split(".");
  const valid =
    extra === undefined &&
    /^\d+$/.test(whole) &&
    /^\d*$/.test(fraction) &&
    fraction.length <= digits &&
    !(digits === 0 && clean.includes("."));
  if (!valid) return null;
  const minorPart = fraction.padEnd(digits, "0");
  return Number(BigInt(whole) * 10n ** BigInt(digits) + BigInt(minorPart || "0"));
}

/** Minor units as an editable major-unit string ("1500.50"). */
export function toMajorText(minor: number, currency = "NGN"): string {
  const digits = MINOR_DIGITS[currency] ?? 2;
  const scale = 10n ** BigInt(digits);
  const units = BigInt(minor);
  return digits
    ? `${units / scale}.${(units % scale).toString().padStart(digits, "0")}`
    : `${units}`;
}
