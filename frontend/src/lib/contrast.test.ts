import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AA_TEXT, contrastRatio } from "./contrast";
import { parseTokens, TEXT_PAIRS } from "./design-tokens";
import { TONES } from "./status-map";

const styles = join(process.cwd(), "src", "styles");
const tokens = parseTokens(readFileSync(join(styles, "tokens.css"), "utf-8"));
const theme = readFileSync(join(styles, "theme.css"), "utf-8");

function value(name: string): string {
  const v = tokens[name];
  if (!v) throw new Error(`No token --${name} in tokens.css`);
  return v;
}

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("#3f5de7", "#ffffff")).toBeCloseTo(5.34, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#243444", "#f4f6fa")).toBe(contrastRatio("#f4f6fa", "#243444"));
  });

  it("rejects anything but #rrggbb", () => {
    expect(() => contrastRatio("rgba(0,0,0,.5)", "#ffffff")).toThrow();
  });
});

describe("text colour pairs used in DESIGN.md", () => {
  it.each(TEXT_PAIRS)("$text on $background ($use) reaches 4.5:1", ({ text, background }) => {
    expect(contrastRatio(value(text), value(background))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("status tones", () => {
  it.each(Object.entries(TONES))("%s text is readable on its tint and on white", (_, tone) => {
    const text = value(tone.tokens.text);
    expect(contrastRatio(text, value(tone.tokens.tint))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(text, value("surface"))).toBeGreaterThanOrEqual(AA_TEXT);
    value(tone.tokens.solid);
  });
});

describe("theme.css", () => {
  it("only refers to tokens that exist", () => {
    const used = [...theme.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !(name in tokens))).toEqual([]);
  });

  it("holds no colour values of its own", () => {
    expect(theme).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
