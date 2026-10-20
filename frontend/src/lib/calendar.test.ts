import { describe, expect, it } from "vitest";

import type { Appointment } from "./appointments";
import {
  addDays,
  canFinish,
  canMove,
  clock,
  columnAt,
  dayStartIso,
  HOUR_PX,
  instantAt,
  lagosDateOf,
  minutesAtOffset,
  minutesOnDay,
  NEXT_STATUSES,
  placeAppointments,
  rangeFor,
  reference,
  unavailableSpans,
  visibleHours,
  weekDays,
  weekStart,
} from "./calendar";

const DAY = "2026-10-16"; // a Friday

function appointment(id: string, from: string, to: string): Appointment {
  return {
    id,
    patient: "p",
    patient_name: "Ngozi Eze",
    patient_mrn: "2026-000001",
    physician: "d",
    facility: "f",
    appointment_type: "new",
    start_at: instantAt(DAY, minutes(from)),
    end_at: instantAt(DAY, minutes(to)),
    status: "booked",
    created_at: "2026-10-01T00:00:00Z",
  } as Appointment;
}

function minutes(clockTime: string) {
  const [h, m] = clockTime.split(":").map(Number);
  return h * 60 + m;
}

describe("dates", () => {
  it("adds days across month ends and finds the Monday of a week", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekStart("2026-10-16")).toBe("2026-10-12");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday belongs to the week before
    expect(weekDays("2026-10-16")).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });

  it("ranges are in Lagos time, whatever the browser's zone", () => {
    expect(dayStartIso(DAY)).toBe("2026-10-16T00:00:00+01:00");
    expect(rangeFor(DAY)).toEqual({
      from: "2026-10-16T00:00:00+01:00",
      to: "2026-10-17T00:00:00+01:00",
    });
    expect(rangeFor(DAY, 7).to).toBe("2026-10-23T00:00:00+01:00");
  });

  it("works out the Lagos day and minutes of an instant", () => {
    // 23:30 UTC on the 15th is 00:30 on the 16th in Lagos.
    expect(lagosDateOf("2026-10-15T23:30:00Z")).toBe("2026-10-16");
    expect(minutesOnDay("2026-10-15T23:30:00Z", DAY)).toBe(30);
    expect(minutesOnDay(instantAt(DAY, 9 * 60 + 15), DAY)).toBe(555);
    expect(clock(555)).toBe("09:15");
    expect(instantAt(DAY, 600)).toBe("2026-10-16T10:00:00+01:00");
  });
});

describe("visible hours", () => {
  it("keeps the working day, and widens it for anything outside", () => {
    expect(visibleHours(DAY, [])).toEqual([8, 18]);
    expect(visibleHours(DAY, [appointment("a", "09:00", "10:00")])).toEqual([8, 18]);
    expect(visibleHours(DAY, [appointment("a", "06:30", "07:00")])).toEqual([6, 18]);
    expect(visibleHours(DAY, [appointment("a", "17:30", "19:15")])).toEqual([8, 20]);
  });
});

describe("placing appointments", () => {
  it("positions by time and scales height with the length", () => {
    const [placed] = placeAppointments([appointment("a", "09:00", "10:00")], DAY, 8);
    expect(placed.top).toBe(HOUR_PX); // one hour after 08:00
    expect(placed.height).toBe(HOUR_PX);
    expect(placed.lane).toBe(0);
    expect(placed.lanes).toBe(1);
  });

  it("never draws a card too short to read", () => {
    const [placed] = placeAppointments([appointment("a", "09:00", "09:10")], DAY, 8);
    expect(placed.height).toBeGreaterThanOrEqual(36);
  });

  it("puts overlapping appointments side by side and back to back ones alone", () => {
    const placed = placeAppointments(
      [
        appointment("a", "09:00", "09:30"),
        appointment("b", "09:15", "09:45"), // overlaps a: an emergency overbooking
        appointment("c", "09:45", "10:00"), // starts as b ends
        appointment("d", "11:00", "11:15"),
      ],
      DAY,
      8,
    );
    const by = Object.fromEntries(placed.map((p) => [p.appointment.id, p]));
    expect([by.a.lane, by.a.lanes]).toEqual([0, 2]);
    expect([by.b.lane, by.b.lanes]).toEqual([1, 2]);
    expect([by.c.lane, by.c.lanes]).toEqual([0, 1]); // starts as b ends: full width again
    expect([by.d.lane, by.d.lanes]).toEqual([0, 1]);
  });
});

describe("availability", () => {
  const window = (from: string, to: string) => ({
    start_at: instantAt(DAY, minutes(from)),
    end_at: instantAt(DAY, minutes(to)),
  });

  it("hatches whatever is outside the windows", () => {
    expect(unavailableSpans([window("09:00", "12:00")], DAY, 8, 18)).toEqual([
      { top: 0, height: HOUR_PX },
      { top: 4 * HOUR_PX, height: 6 * HOUR_PX },
    ]);
  });

  it("hatches the whole day when there are no windows", () => {
    expect(unavailableSpans([], DAY, 8, 18)).toEqual([{ top: 0, height: 10 * HOUR_PX }]);
  });

  it("merges touching and overlapping windows and ignores ones off the grid", () => {
    const spans = unavailableSpans(
      [
        window("09:00", "11:00"),
        window("10:30", "12:00"),
        window("12:00", "13:00"),
        window("19:00", "20:00"),
      ],
      DAY,
      8,
      18,
    );
    expect(spans).toEqual([
      { top: 0, height: HOUR_PX },
      { top: 5 * HOUR_PX, height: 5 * HOUR_PX },
    ]);
  });
});

describe("dragging", () => {
  it("snaps a vertical position to the 15-minute grid", () => {
    expect(minutesAtOffset(0, 8)).toBe(8 * 60);
    expect(minutesAtOffset(HOUR_PX, 8)).toBe(9 * 60);
    expect(minutesAtOffset(HOUR_PX * 1.3, 8)).toBe(9 * 60 + 15); // 78 min after 8:00 -> 9:18 -> 9:15
    expect(minutesAtOffset(HOUR_PX * 1.4, 8)).toBe(9 * 60 + 30);
  });

  it("finds the column under the pointer, or the nearest", () => {
    const columns = [
      { key: "a", left: 0, right: 100 },
      { key: "b", left: 100, right: 200 },
    ];
    expect(columnAt(50, columns)?.key).toBe("a");
    expect(columnAt(100, columns)?.key).toBe("b");
    expect(columnAt(260, columns)?.key).toBe("b");
    expect(columnAt(-40, columns)?.key).toBe("a");
    expect(columnAt(10, [])).toBeUndefined();
  });
});

describe("statuses", () => {
  it("offers only the moves the server allows", () => {
    expect(NEXT_STATUSES.booked).toContain("checked_in");
    expect(NEXT_STATUSES.in_consultation).toEqual(["completed"]);
    for (const done of ["completed", "no_show", "cancelled"] as const) {
      expect(NEXT_STATUSES[done]).toEqual([]);
    }
  });

  it("lets only an appointment that has not started be moved", () => {
    expect(canMove("booked")).toBe(true);
    expect(canMove("confirmed")).toBe(true);
    expect(canMove("checked_in")).toBe(false);
    expect(canMove("completed")).toBe(false);
  });

  it("can finish a visit only when vitals and a clinical record both exist", () => {
    expect(canFinish({ vitals: 0, records: 0 })).toBe(false);
    expect(canFinish({ vitals: 1, records: 0 })).toBe(false);
    expect(canFinish({ vitals: 0, records: 2 })).toBe(false);
    expect(canFinish({ vitals: 1, records: 1 })).toBe(true);
  });

  it("shows the short reference patients are given", () => {
    expect(reference("ab12cd34-0000-4000-8000-000000000000")).toBe(`#${"AB12CD34"}`);
  });
});
