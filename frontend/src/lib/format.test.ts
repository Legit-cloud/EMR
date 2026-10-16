import { describe, expect, it } from "vitest";

import { formatMoney, toMajorText, toMinor } from "./format";

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
