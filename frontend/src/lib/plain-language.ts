/**
 * Plain-language wording for the patient portal. A patient never sees a clinical term, an
 * abbreviation or a result without a sentence that says what it is in everyday words
 * (docs/DESIGN.md Section 8). Nothing here interprets a result as a diagnosis: it says where the
 * number sits against the usual range and leaves the meaning to the doctor.
 *
 * The wording is a starting list. A clinician should review it before patients see it.
 */

/** What a test or scan is, in one sentence, keyed by lower-case name. */
const TESTS: Record<string, string> = {
  haemoglobin: "Measures the protein in your blood that carries oxygen around your body.",
  "full blood count": "Counts the different kinds of cells in your blood.",
  "malaria parasite": "Checks your blood for the germ that causes malaria.",
  "fasting glucose": "Measures the sugar in your blood after not eating for several hours.",
  creatinine: "Shows how well your kidneys are clearing waste from your blood.",
  hba1c: "Shows your average blood sugar over the last three months.",
  "chest x-ray": "A picture of your lungs, heart and the bones of your chest.",
  "blood pressure": "How hard your blood pushes against the walls of your blood vessels.",
};

export function explainTest(name: string): string {
  return TESTS[name.trim().toLowerCase()] ?? "A test your doctor asked for.";
}

export type ResultFlag = "normal" | "low" | "high" | "abnormal";

/** Where a result sits, in words that do not alarm and do not diagnose. */
export const RESULT_FLAG_TEXT: Record<ResultFlag, { label: string; sentence: string }> = {
  normal: { label: "In the usual range", sentence: "This is within the usual range." },
  low: {
    label: "A little low",
    sentence:
      "This is lower than the usual range. Your doctor will tell you what it means for you.",
  },
  high: {
    label: "A little high",
    sentence:
      "This is higher than the usual range. Your doctor will tell you what it means for you.",
  },
  abnormal: {
    label: "Needs your doctor",
    sentence: "Your doctor will go through this result with you.",
  },
};

export function describeRange(
  low: number | null,
  high: number | null,
  unit: string,
): string | null {
  const u = unit ? ` ${unit}` : "";
  if (low !== null && high !== null) return `The usual range is ${low} to ${high}${u}.`;
  if (high !== null) return `The usual level is up to ${high}${u}.`;
  if (low !== null) return `The usual level is at least ${low}${u}.`;
  return null;
}

/** Common prescribing shorthand, written out. Anything else is shown as the clinician wrote it. */
const FREQUENCY: Record<string, string> = {
  od: "once a day",
  qd: "once a day",
  bd: "twice a day",
  bid: "twice a day",
  tds: "three times a day",
  tid: "three times a day",
  qds: "four times a day",
  qid: "four times a day",
  nocte: "at night",
  mane: "in the morning",
  prn: "only when you need it",
  stat: "right away, once",
};

const ROUTE: Record<string, string> = {
  oral: "by mouth",
  po: "by mouth",
  topical: "on the skin",
  im: "as an injection into a muscle",
  iv: "through a drip into a vein",
  sc: "as an injection under the skin",
  inhaled: "breathed in",
};

export function plainFrequency(text: string): string {
  const clean = text.trim();
  return FREQUENCY[clean.toLowerCase()] ?? clean.toLowerCase();
}

export type PrescriptionLine = {
  dose: string;
  frequency: string;
  route: string;
  duration_days: number;
};

/** "Take 1 tablet three times a day, by mouth, for 4 days." */
export function plainInstructions(item: PrescriptionLine): string {
  const how = ROUTE[item.route.trim().toLowerCase()] ?? item.route.trim().toLowerCase();
  const days = item.duration_days === 1 ? "1 day" : `${item.duration_days} days`;
  return `Take ${item.dose.trim()} ${plainFrequency(item.frequency)}${how ? `, ${how}` : ""}, for ${days}.`;
}

const MEDICINES: Record<string, string> = {
  amoxicillin: "An antibiotic that fights infections caused by bacteria.",
  paracetamol: "Eases pain and brings down a fever.",
  ibuprofen: "Eases pain and swelling and brings down a fever.",
  methyldopa: "Lowers high blood pressure, and is often used in pregnancy.",
  warfarin: "A blood thinner that helps prevent clots.",
  metronidazole: "An antibiotic for some infections of the gut and mouth.",
};

export function explainMedicine(name: string): string {
  const first = name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return MEDICINES[first] ?? "Ask your pharmacist what this medicine is for.";
}
