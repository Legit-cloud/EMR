import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_STATUS,
  BED_STATUS,
  PAYMENT_STATUS,
  type StatusSpec,
  TONES,
  TRIAGE_LEVEL,
} from "./status-map";

const MAPS: Record<string, Record<string, StatusSpec>> = {
  appointment: APPOINTMENT_STATUS,
  payment: PAYMENT_STATUS,
  triage: TRIAGE_LEVEL,
  bed: BED_STATUS,
};

describe("status map", () => {
  it("covers all seven appointment states", () => {
    expect(Object.keys(APPOINTMENT_STATUS).sort()).toEqual(
      [
        "booked",
        "cancelled",
        "checked_in",
        "completed",
        "confirmed",
        "in_consultation",
        "no_show",
      ].sort(),
    );
  });

  it("follows the colours fixed in DESIGN.md Section 2.4", () => {
    const tones = (map: Record<string, StatusSpec>) =>
      Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.tone]));
    expect(tones(APPOINTMENT_STATUS)).toEqual({
      booked: "sky",
      confirmed: "blue",
      checked_in: "teal",
      in_consultation: "purple",
      completed: "green",
      no_show: "amber",
      cancelled: "pink",
    });
    expect(tones(PAYMENT_STATUS)).toEqual({
      paid: "green",
      partially_paid: "amber",
      unpaid: "pink",
    });
    expect(tones(TRIAGE_LEVEL)).toEqual({
      emergency: "pink",
      urgent: "amber",
      routine: "sky",
      non_urgent: "grey",
    });
    expect(tones(BED_STATUS)).toEqual({
      vacant: "green",
      occupied: "sky",
      cleaning: "amber",
      out_of_service: "grey",
    });
  });

  it.each(Object.entries(TONES))("%s classes use the tone's own tokens", (_, tone) => {
    expect(tone.text).toBe(`text-${tone.tokens.text}`);
    expect(tone.pill).toBe(`bg-${tone.tokens.tint} text-${tone.tokens.text}`);
    expect(tone.card).toBe(`bg-${tone.tokens.tint} border border-${tone.tokens.solid}/40`);
    expect(tone.dot).toBe(`bg-${tone.tokens.solid}`);
    expect(tone.icon).toBe(`text-${tone.tokens.solid}`);
  });

  it.each(Object.entries(MAPS))(
    "%s entries all have a label, a known tone and an icon",
    (_, map) => {
      for (const spec of Object.values(map)) {
        expect(spec.label).not.toBe("");
        expect(TONES).toHaveProperty(spec.tone);
        expect(spec.icon).toBeTruthy();
      }
    },
  );
});
