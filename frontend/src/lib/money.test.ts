import { describe, expect, it } from "vitest";

import {
  allocate,
  compactMoney,
  currencySymbol,
  formatMoney,
  minorDigits,
  sumMinor,
  toMajorText,
  toMinor,
} from "./money";

describe("formatMoney", () => {
  it.each([
    [1_030_000, "NGN", "₦10,300.00"],
    [5, "NGN", "₦0.05"],
    [0, "NGN", "₦0.00"],
    [-12_050, "NGN", "-₦120.50"],
    [123_456_789_012, "NGN", "₦1,234,567,890.12"],
    [250_000, "USD", "USD 2,500.00"],
    [1_200, "XOF", "XOF 1,200"],
  ])("shows %i %s as %s", (minor, currency, expected) => {
    expect(formatMoney(minor, currency)).toBe(expected);
  });

  it("knows each currency's decimals and symbol", () => {
    expect(minorDigits("NGN")).toBe(2);
    expect(minorDigits("XOF")).toBe(0);
    expect(currencySymbol("NGN")).toBe("₦");
    expect(currencySymbol("GHS")).toBe("GHS ");
  });

  it("never shows a rounding error: every kobo value reads back exactly", () => {
    for (const minor of [1, 7, 99, 100, 101, 999_999, 1_000_001, 9_007_199_254_740]) {
      expect(toMinor(toMajorText(minor))).toBe(minor);
    }
  });
});

describe("compactMoney rounds half up to one decimal, without floats", () => {
  it.each([
    [9_800_000, "₦98k"],
    [123_456_789, "₦1.2m"],
    [50_000, "₦500"],
    [50_049, "₦500"],
    [50_050, "₦501"],
    [0, "₦0"],
    [149_999, "₦1.5k"],
    [99_995_000, "₦1m"],
    [-250_000, "-₦2.5k"],
  ])("%i is %s", (minor, expected) => {
    expect(compactMoney(minor, "NGN")).toBe(expected);
  });
});

describe("sumMinor", () => {
  it("adds exactly", () => {
    expect(sumMinor([])).toBe(0);
    expect(sumMinor([1_030_000, -530_000, 5])).toBe(500_005);
    expect(sumMinor([Number.MAX_SAFE_INTEGER - 5, 2, 3])).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("allocate splits an amount without losing a minor unit", () => {
  it("gives leftover units to the earliest non-zero shares", () => {
    expect(allocate(10_001, [8_000, 2_000])).toEqual([8_001, 2_000]);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
  });

  it("gives a zero weight nothing", () => {
    expect(allocate(5, [0, 1])).toEqual([0, 5]);
    expect(allocate(999, [10_000, 0])).toEqual([999, 0]);
  });

  it("splits a negative amount the same way, mirrored", () => {
    expect(allocate(-10_001, [8_000, 2_000])).toEqual([-8_001, -2_000]);
  });

  it("always adds back up to the whole, for many amounts and splits", () => {
    for (const bp of [0, 1, 3_333, 5_000, 8_250, 9_999, 10_000]) {
      for (let amount = 0; amount < 400; amount += 7) {
        const [insurer, patient] = allocate(amount, [bp, 10_000 - bp]);
        expect(insurer + patient).toBe(amount);
        if (bp === 0) expect(insurer).toBe(0);
        if (bp === 10_000) expect(patient).toBe(0);
      }
    }
  });

  it("refuses weights that cannot split anything", () => {
    expect(() => allocate(100, [0, 0])).toThrow(RangeError);
    expect(() => allocate(100, [-1, 2])).toThrow(RangeError);
  });
});

describe("toMinor", () => {
  it("rejects what is not an amount", () => {
    for (const text of ["", "abc", "1.005", "-5", "1e3", "1.2.3"]) {
      expect(toMinor(text)).toBeNull();
    }
  });

  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    expect((toMinor("0.1") ?? 0) + (toMinor("0.2") ?? 0)).toBe(toMinor("0.3"));
    expect(toMinor("1.15")).toBe(115);
    expect(toMinor("4.35")).toBe(435);
  });
});
