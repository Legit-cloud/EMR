import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { percentages } from "./chart-colours";

const SRC = join(process.cwd(), "src");
// tokens.css is where colour values live; tests may use literal colours as inputs.
const ALLOWED = [/^styles[\\/]tokens\.css$/, /\.test\.tsx?$/];
// CSS colour lengths only, so IDs such as "Bill #10102" do not count.
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("design rules (docs/DESIGN.md Section 12)", () => {
  it("has no raw hex colours outside tokens.css", () => {
    const offenders = files(SRC)
      .filter((path) => /\.(tsx?|css)$/.test(path))
      .map((path) => relative(SRC, path))
      .filter((path) => !ALLOWED.some((rule) => rule.test(path)))
      .flatMap((path) =>
        readFileSync(join(SRC, path), "utf-8")
          .split("\n")
          .map((line, i) => ({ line, at: `${path}:${i + 1}` }))
          .filter(({ line }) => HEX.test(line))
          .map(({ at, line }) => `${at}  ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
    // Reads every source file; over a bind mount under parallel load that can take a while.
  }, 60_000);
});

describe("percentages", () => {
  it("rounds to whole numbers and copes with an empty total", () => {
    expect(percentages([1, 1, 2])).toEqual([25, 25, 50]);
    expect(percentages([0, 0])).toEqual([0, 0]);
  });
});
