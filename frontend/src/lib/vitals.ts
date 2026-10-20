import type { Schemas } from "./api";

/** LOINC codes the chart shows (apps/clinical/data/codes.json). */
export const LOINC = {
  systolic: "8480-6",
  diastolic: "8462-4",
  heartRate: "8867-4",
  temperature: "8310-5",
  oxygen: "59408-5",
  bmi: "39156-5",
} as const;

type VitalSet = Schemas["VitalSigns"];

/** The numeric value of one reading in a set, or undefined. */
export function reading(set: VitalSet | undefined, code: string): number | undefined {
  const found = set?.observations.find((o) => o.code === code);
  return found === undefined ? undefined : Number(found.value);
}

export type Assessment = "normal" | "low" | "high";

type Range = { low?: number; high?: number };

/**
 * Adult reference limits used to colour a reading. A value below `low` or at or above `high`
 * is flagged. These are screening aids for the chart, NOT diagnostic criteria, and they are
 * waiting for sign-off by the clinical lead (see docs/adr/0013). Children's ranges differ
 * with age, so nothing is flagged for patients under 18.
 */
export const ADULT_RANGES: Record<string, Range> = {
  [LOINC.systolic]: { low: 90, high: 140 },
  [LOINC.diastolic]: { low: 60, high: 90 },
  // Heart rate: 60 to 100 is normal, so 100 itself is not flagged.
  [LOINC.heartRate]: { low: 60, high: 100.01 },
  [LOINC.temperature]: { low: 35.5, high: 37.5 },
  [LOINC.oxygen]: { low: 95 },
  [LOINC.bmi]: { low: 18.5, high: 30 },
};

export const ADULT_AGE = 18;

export function assess(
  code: string,
  value: number | undefined,
  ageYears: number,
): Assessment | null {
  if (value === undefined || Number.isNaN(value) || ageYears < ADULT_AGE) return null;
  const range = ADULT_RANGES[code];
  if (!range) return null;
  if (range.low !== undefined && value < range.low) return "low";
  if (range.high !== undefined && value >= range.high) return "high";
  return "normal";
}

/** The worse of two assessments, so a tile with two readings (blood pressure) flags either. */
export function worst(...items: (Assessment | null)[]): Assessment | null {
  const present = items.filter((i): i is Assessment => i !== null);
  if (present.length === 0) return null;
  return present.find((i) => i !== "normal") ?? "normal";
}

export type TileSpec = {
  id: string;
  label: string;
  unit: string;
  /** Codes that make up the tile: one, or systolic then diastolic. */
  codes: string[];
  /** Digits after the decimal point. */
  digits: number;
};

export const TILES: TileSpec[] = [
  {
    id: "bp",
    label: "Blood pressure",
    unit: "mmHg",
    codes: [LOINC.systolic, LOINC.diastolic],
    digits: 0,
  },
  { id: "hr", label: "Heart rate", unit: "/min", codes: [LOINC.heartRate], digits: 0 },
  { id: "temp", label: "Temperature", unit: "°C", codes: [LOINC.temperature], digits: 1 },
  { id: "spo2", label: "Oxygen saturation", unit: "%", codes: [LOINC.oxygen], digits: 0 },
  { id: "bmi", label: "BMI", unit: "kg/m²", codes: [LOINC.bmi], digits: 1 },
];

export function formatReading(value: number, digits: number): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export type TileReading = {
  /** "120/80" or "96". */
  text: string;
  /** The first code's value, for deltas and trends. */
  primary: number;
  assessment: Assessment | null;
};

/** What a tile shows for one set of vital signs, or null if the set has none of its readings. */
export function tileReading(
  spec: TileSpec,
  set: VitalSet | undefined,
  ageYears: number,
): TileReading | null {
  const values = spec.codes.map((code) => reading(set, code));
  if (values[0] === undefined) return null;
  const shown = values.filter((v): v is number => v !== undefined);
  return {
    text: shown.map((v) => formatReading(v, spec.digits)).join("/"),
    primary: values[0],
    assessment: worst(...spec.codes.map((code, i) => assess(code, values[i], ageYears))),
  };
}

/** Vital-sign sets that contain this tile's first reading, newest first. */
export function setsWith(spec: TileSpec, sets: VitalSet[]): VitalSet[] {
  return sets.filter((s) => reading(s, spec.codes[0]) !== undefined);
}

/** Readings oldest to newest for a trend line, labelled by date. */
export function trend(
  sets: VitalSet[],
  code: string,
  label: (iso: string) => string,
): { label: string; value: number }[] {
  return sets
    .filter((s) => reading(s, code) !== undefined)
    .map((s) => ({ label: label(s.recorded_at ?? s.created_at), value: reading(s, code)! }))
    .reverse();
}
