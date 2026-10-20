import { describe, expect, it } from "vitest";

import { backoffDelay } from "./queue";
import { formatWait, triageLevel, waitMinutes, waitTone } from "./triage";

describe("queue triage and waiting (FR-3.x)", () => {
  it("maps the stored priority 1 to 5 onto the four levels", () => {
    expect([1, 2, 3, 4, 5].map(triageLevel)).toEqual([
      "emergency",
      "urgent",
      "routine",
      "non_urgent",
      "non_urgent",
    ]);
  });

  it("has no level for a patient who has not been triaged", () => {
    expect(triageLevel(null)).toBeNull();
    expect(triageLevel(undefined)).toBeNull();
  });

  it("turns the waiting chip amber, then pink, at the thresholds", () => {
    const thresholds = { longMinutes: 15, veryLongMinutes: 30 };
    expect(waitTone(14, thresholds)).toBe("normal");
    expect(waitTone(15, thresholds)).toBe("long");
    expect(waitTone(29, thresholds)).toBe("long");
    expect(waitTone(30, thresholds)).toBe("very_long");
  });

  it("counts whole minutes waited and never goes negative", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(waitMinutes("2026-10-20T09:45:30Z", now)).toBe(14);
    expect(waitMinutes("2026-10-20T10:05:00Z", now)).toBe(0);
  });

  it("writes waits in minutes, then hours and minutes", () => {
    expect(formatWait(0)).toBe("0 min");
    expect(formatWait(59)).toBe("59 min");
    expect(formatWait(65)).toBe("1 h 05 min");
  });

  it("backs off between reconnect attempts, up to 30 seconds", () => {
    expect([1, 2, 3, 10].map(backoffDelay)).toEqual([2000, 4000, 8000, 30_000]);
  });
});
