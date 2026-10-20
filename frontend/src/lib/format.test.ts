import { describe, expect, it } from "vitest";

import { ageLabel, compactMoney, formatDay, formatMoney, toMajorText, toMinor } from "./format";

describe("toMinor: typed amounts to integer minor units, never floats", () => {
  it.each([
    ["120.50", 12050],
    ["150", 15000],
    ["1,500.5", 150050],
    ["0.05", 5],
    ["0.1", 10],
  ])("parses %s", (text, minor) => {
    expect(toMinor(text)).toBe(minor);
  });

  it.each(["1.005", "abc", "1.2.3", "", "-5", "1e3"])("rejects %s", (text) => {
    expect(toMinor(text)).toBeNull();
  });

  it("respects currencies without minor units", () => {
    expect(toMinor("500", "XOF")).toBe(500);
    expect(toMinor("5.5", "XOF")).toBeNull();
  });

  it("does not suffer floating-point error (0.1 + 0.2)", () => {
    expect((toMinor("0.1") ?? 0) + (toMinor("0.2") ?? 0)).toBe(toMinor("0.3"));
  });
});

describe("formatMoney and toMajorText", () => {
  it("formats kobo as naira with grouping and two decimals", () => {
    expect(formatMoney(1_030_000, "NGN")).toBe("₦10,300.00");
    expect(formatMoney(5, "NGN")).toBe("₦0.05");
    expect(formatMoney(-12050, "NGN")).toBe("-₦120.50");
  });

  it("round-trips through the editable text form", () => {
    expect(toMinor(toMajorText(12050))).toBe(12050);
  });
});

describe("compactMoney", () => {
  it("shortens to thousands and millions for chart axes", () => {
    expect(compactMoney(9_800_000, "NGN")).toBe("₦98k");
    expect(compactMoney(123_456_789, "NGN")).toBe("₦1.2m");
    expect(compactMoney(50_000, "NGN")).toBe("₦500");
    expect(compactMoney(0, "NGN")).toBe("₦0");
    expect(compactMoney(-250_000, "USD")).toBe("-USD 2.5k");
  });
});

describe("ageLabel and formatDay", () => {
  const today = new Date(2026, 9, 19); // 19 October 2026

  it("shows years, and months for a baby under one", () => {
    expect(ageLabel("1990-10-19", today)).toBe("36 yrs");
    expect(ageLabel("1990-10-20", today)).toBe("35 yrs");
    expect(ageLabel("2026-03-19", today)).toBe("7 mo");
    expect(ageLabel("2026-10-18", today)).toBe("0 mo");
  });

  it("shows the Lagos day of a timestamp, and a dash for none", () => {
    // 23:30 UTC on 14 Oct is already 15 Oct in Lagos (UTC+1).
    expect(formatDay("2026-10-14T23:30:00Z")).toBe("15 Oct 2026");
    expect(formatDay(null)).toBe("—");
  });
});
