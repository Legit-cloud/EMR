/**
 * Money arrives as integer minor units (kobo for the naira) with an ISO currency code. Every
 * conversion, sum and display in the app goes through this file, and none of it uses
 * floating-point arithmetic, so a displayed amount can never differ from the stored one by a
 * rounding error. Division only ever happens on BigInt.
 */

/** Currencies with no minor unit. Everything else is assumed to have two decimal places. */
const MINOR_DIGITS: Record<string, number> = { XOF: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

export function currencySymbol(currency: string): string {
  return currency === "NGN" ? "₦" : `${currency} `;
}

function scaleOf(currency: string): bigint {
  return 10n ** BigInt(minorDigits(currency));
}

/** The exact total of amounts in one currency. Safe for any realistic number of lines. */
export function sumMinor(amounts: readonly number[]): number {
  return Number(amounts.reduce((total, amount) => total + BigInt(amount), 0n));
}

/** "₦13,232.00", "-₦500.00", "XOF 1,200". */
export function formatMoney(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  const units = BigInt(Math.abs(minor));
  const scale = scaleOf(currency);
  const whole = (units / scale).toLocaleString("en-NG");
  const fraction = digits ? `.${(units % scale).toString().padStart(digits, "0")}` : "";
  return `${minor < 0 ? "-" : ""}${currencySymbol(currency)}${whole}${fraction}`;
}

/** Whole units, rounded half up, from minor units: 12,550 kobo is 126 naira. */
function roundedUnits(minorAbs: bigint, scale: bigint, per = 1n): bigint {
  const divisor = scale * per;
  return (minorAbs * 2n + divisor) / (divisor * 2n);
}

/**
 * Short amounts for chart axes and tight spaces: "₦98k", "₦1.2m". Display only: use
 * formatMoney wherever the exact amount matters. Rounds half up to one decimal.
 */
export function compactMoney(minor: number, currency: string): string {
  const scale = scaleOf(currency);
  const abs = BigInt(Math.abs(minor));
  const sign = minor < 0 ? "-" : "";
  const symbol = currencySymbol(currency);

  const tenths = (per: bigint) => (abs * 20n + scale * per) / (scale * per * 2n);
  const text = (value: bigint) => {
    const whole = value / 10n;
    const fraction = value % 10n;
    return fraction === 0n ? `${whole}` : `${whole}.${fraction}`;
  };

  const millions = tenths(1_000_000n);
  if (millions >= 10n) return `${sign}${symbol}${text(millions)}m`;
  const thousands = tenths(1_000n);
  // 999,950 rounds up to 1000.0k, which reads better as 1m.
  if (thousands >= 10_000n) return `${sign}${symbol}${text(millions)}m`;
  if (thousands >= 10n) return `${sign}${symbol}${text(thousands)}k`;
  return `${sign}${symbol}${roundedUnits(abs, scale)}`;
}

/**
 * Parse a typed major-unit amount ("1,500.50") into integer minor units without floating
 * point. Returns null when it is not a valid amount for the currency.
 */
export function toMinor(text: string, currency = "NGN"): number | null {
  const digits = minorDigits(currency);
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
  return Number(BigInt(whole) * scaleOf(currency) + BigInt(minorPart || "0"));
}

/** Minor units as an editable major-unit string ("1500.50"). */
export function toMajorText(minor: number, currency = "NGN"): string {
  const digits = minorDigits(currency);
  const scale = scaleOf(currency);
  const units = BigInt(minor);
  return digits
    ? `${units / scale}.${(units % scale).toString().padStart(digits, "0")}`
    : `${units}`;
}

/**
 * Split an amount by whole-number weights (for example insurer 8000, patient 2000 basis
 * points) without losing a minor unit. Leftover units go one each to the earliest non-zero
 * weights, the same rule as the server's Money.allocate, so the parts always add up.
 */
export function allocate(minor: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  if (weights.some((weight) => weight < 0) || total === 0n) {
    throw new RangeError("Weights must be non-negative with a positive total");
  }
  const amount = BigInt(Math.abs(minor));
  const shares = weights.map((weight) => (amount * BigInt(weight)) / total);
  const receivers = weights.flatMap((weight, i) => (weight > 0 ? [i] : []));
  let leftover = Number(amount - shares.reduce((sum, share) => sum + share, 0n));
  for (let i = 0; leftover > 0; i++, leftover--) shares[receivers[i]] += 1n;
  const sign = minor < 0 ? -1 : 1;
  return shares.map((share) => sign * Number(share));
}
