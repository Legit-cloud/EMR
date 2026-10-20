import { describe, expect, it } from "vitest";

import { previewBmi } from "@/components/chart/record-vitals-modal";

import type { Schemas } from "./api";
import { assess, formatReading, LOINC, setsWith, TILES, tileReading, trend, worst } from "./vitals";

type VitalSet = Schemas["VitalSigns"];

function set(id: string, at: string, readings: Record<string, string>): VitalSet {
  return {
    id,
    patient: "p",
    encounter: "e",
    recorded_at: at,
    recorded_by: "u",
    observations: Object.entries(readings).map(([code, value]) => ({
      code,
      display: code,
      value,
      unit: "",
    })),
    record_state: "active",
    created_at: at,
  };
}

const BP = TILES.find((t) => t.id === "bp")!;
const HR = TILES.find((t) => t.id === "hr")!;

describe("assess (adult reference limits, pending clinical sign-off)", () => {
  it("flags values below the low limit and at or above the high limit", () => {
    expect(assess(LOINC.systolic, 89, 40)).toBe("low");
    expect(assess(LOINC.systolic, 90, 40)).toBe("normal");
    expect(assess(LOINC.systolic, 139, 40)).toBe("normal");
    expect(assess(LOINC.systolic, 140, 40)).toBe("high");
    expect(assess(LOINC.oxygen, 94, 40)).toBe("low");
    expect(assess(LOINC.oxygen, 100, 40)).toBe("normal");
    expect(assess(LOINC.temperature, 37.4, 40)).toBe("normal");
    expect(assess(LOINC.temperature, 37.5, 40)).toBe("high");
    expect(assess(LOINC.temperature, 35.4, 40)).toBe("low");
    expect(assess(LOINC.bmi, 18.4, 40)).toBe("low");
    expect(assess(LOINC.bmi, 30, 40)).toBe("high");
  });

  it("treats a heart rate of exactly 100 as normal and 101 as high", () => {
    expect(assess(LOINC.heartRate, 60, 40)).toBe("normal");
    expect(assess(LOINC.heartRate, 59, 40)).toBe("low");
    expect(assess(LOINC.heartRate, 100, 40)).toBe("normal");
    expect(assess(LOINC.heartRate, 101, 40)).toBe("high");
  });

  it("flags nothing for children, for unknown codes or for no value", () => {
    expect(assess(LOINC.heartRate, 150, 12)).toBeNull();
    expect(assess(LOINC.heartRate, 150, 17)).toBeNull();
    expect(assess(LOINC.heartRate, 150, 18)).toBe("high");
    expect(assess("29463-7", 400, 40)).toBeNull();
    expect(assess(LOINC.heartRate, undefined, 40)).toBeNull();
    expect(assess(LOINC.heartRate, Number.NaN, 40)).toBeNull();
  });

  it("takes the worse of several assessments", () => {
    expect(worst("normal", "high")).toBe("high");
    expect(worst("low", "normal")).toBe("low");
    expect(worst("normal", null)).toBe("normal");
    expect(worst(null, null)).toBeNull();
  });
});

describe("tiles", () => {
  const now = set("a", "2026-10-19T09:00:00Z", {
    [LOINC.systolic]: "150",
    [LOINC.diastolic]: "85",
    [LOINC.heartRate]: "72",
  });

  it("shows blood pressure as systolic/diastolic and flags either number", () => {
    expect(tileReading(BP, now, 40)).toEqual({ text: "150/85", primary: 150, assessment: "high" });
    expect(tileReading(HR, now, 40)).toEqual({ text: "72", primary: 72, assessment: "normal" });
  });

  it("is empty when the set has no reading for the tile", () => {
    expect(
      tileReading(HR, set("b", "2026-10-19T10:00:00Z", { [LOINC.systolic]: "120" }), 40),
    ).toBeNull();
    expect(tileReading(HR, undefined, 40)).toBeNull();
  });

  it("keeps only the sets that have the tile's reading, in the order given", () => {
    const sets = [now, set("c", "2026-10-18T09:00:00Z", { [LOINC.temperature]: "36.6" })];
    expect(setsWith(HR, sets).map((s) => s.id)).toEqual(["a"]);
  });

  it("trends oldest to newest, labelled by date", () => {
    const newest = set("n", "2026-10-19T09:00:00Z", { [LOINC.heartRate]: "90" });
    const oldest = set("o", "2026-10-01T09:00:00Z", { [LOINC.heartRate]: "70" });
    expect(trend([newest, oldest], LOINC.heartRate, (iso) => iso.slice(5, 10))).toEqual([
      { label: "10-01", value: 70 },
      { label: "10-19", value: 90 },
    ]);
  });

  it("formats readings to the tile's digits", () => {
    expect(formatReading(37, 1)).toBe("37.0");
    expect(formatReading(96.4, 0)).toBe("96");
  });
});

describe("previewBmi", () => {
  it("calculates from kilograms and centimetres, like the server", () => {
    expect(previewBmi("64", "160")).toBeCloseTo(25, 1);
  });

  it("waits until both are valid positive numbers", () => {
    expect(previewBmi("", "160")).toBeNull();
    expect(previewBmi("64", "")).toBeNull();
    expect(previewBmi("0", "160")).toBeNull();
    expect(previewBmi("abc", "160")).toBeNull();
  });
});
