import type { Schemas } from "./api";
import type { Appointment } from "./appointments";

/**
 * Calendar geometry and dates for the appointments screen. Everything is in Lagos time: the
 * clinic's day is the Lagos day whatever the browser's zone, and Lagos has no daylight saving,
 * so a fixed +01:00 offset is exact.
 */
export const LAGOS_OFFSET = "+01:00";
export const LAGOS_LABEL = "GMT +01:00";

export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 18;
export const HOUR_PX = 60;
/** Appointments snap to this many minutes when dragged (the booking slot length). */
export const SNAP_MINUTES = 15;
/** A card is never shorter than this, so a 15-minute visit still shows its name. */
const MIN_CARD_PX = 36;

// -- dates ("YYYY-MM-DD", the Lagos calendar day) ------------------------------------

function utcDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: string, days: number): string {
  const moved = utcDay(date);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const sinceMonday = (utcDay(date).getUTCDay() + 6) % 7;
  return addDays(date, -sinceMonday);
}

export function weekDays(date: string): string[] {
  const first = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The instant a Lagos day starts, as an ISO string with the offset. */
export function dayStartIso(date: string): string {
  return `${date}T00:00:00${LAGOS_OFFSET}`;
}

/** [from, to) covering `days` days from `date`, for the API's start-time range. */
export function rangeFor(date: string, days = 1): { from: string; to: string } {
  return { from: dayStartIso(date), to: dayStartIso(addDays(date, days)) };
}

/** The Lagos day of an instant. */
export function lagosDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/** Minutes after midnight (Lagos) of `iso`, relative to the start of `date`. */
export function minutesOnDay(iso: string, date: string): number {
  return Math.round((Date.parse(iso) - Date.parse(dayStartIso(date))) / 60_000);
}

export function formatLongDate(date: string): string {
  return utcDay(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDayHeading(date: string): string {
  return utcDay(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "09:00" for minutes after midnight. */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** An instant for `minutes` after midnight Lagos on `date`. */
export function instantAt(date: string, minutes: number): string {
  return `${date}T${clock(minutes)}:00${LAGOS_OFFSET}`;
}

// -- the visible hours ---------------------------------------------------------------

type Span = { start_at: string; end_at: string };

/**
 * The hours the grid shows: the usual working day, widened to include any appointment or
 * availability window outside it, so nothing is ever drawn off the grid.
 */
export function visibleHours(
  date: string,
  items: Span[],
  fallback: [number, number] = [DEFAULT_START_HOUR, DEFAULT_END_HOUR],
): [number, number] {
  let [start, end] = fallback;
  for (const item of items) {
    const from = Math.max(0, minutesOnDay(item.start_at, date));
    const to = Math.min(24 * 60, minutesOnDay(item.end_at, date));
    if (to <= 0 || from >= 24 * 60) continue;
    start = Math.min(start, Math.floor(from / 60));
    end = Math.max(end, Math.ceil(to / 60));
  }
  return [start, Math.min(end, 24)];
}

export const topOf = (minutes: number, startHour: number) =>
  ((minutes - startHour * 60) * HOUR_PX) / 60;

// -- placing appointments ------------------------------------------------------------

export type Placed = {
  appointment: Appointment;
  top: number;
  height: number;
  /** 0-based column among overlapping appointments (emergencies may overbook a slot). */
  lane: number;
  lanes: number;
};

/** Position each appointment on the day grid, side by side where they overlap. */
export function placeAppointments(
  appointments: Appointment[],
  date: string,
  startHour: number,
): Placed[] {
  const sorted = [...appointments].sort(
    (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id),
  );
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    const lanes = cluster.reduce((most, p) => Math.max(most, p.lane + 1), 0);
    for (const p of cluster) p.lanes = lanes;
    cluster = [];
  };
  for (const appointment of sorted) {
    const from = minutesOnDay(appointment.start_at, date);
    const to = minutesOnDay(appointment.end_at, date);
    if (from >= clusterEnd) close();
    // The first lane whose last appointment has ended.
    const laneEnds = cluster.reduce<number[]>((ends, p) => {
      ends[p.lane] = Math.max(ends[p.lane] ?? -Infinity, minutesOnDay(p.appointment.end_at, date));
      return ends;
    }, []);
    let lane = laneEnds.findIndex((end) => end <= from);
    if (lane === -1) lane = laneEnds.length;
    const item: Placed = {
      appointment,
      top: topOf(from, startHour),
      height: Math.max(((to - from) * HOUR_PX) / 60, MIN_CARD_PX),
      lane,
      lanes: 1,
    };
    cluster.push(item);
    placed.push(item);
    clusterEnd = Math.max(clusterEnd, to);
  }
  close();
  return placed;
}

// -- availability --------------------------------------------------------------------

export type Gap = { top: number; height: number };

/** The parts of the visible day when the physician takes no bookings, as pixel spans. */
export function unavailableSpans(
  windows: Span[],
  date: string,
  startHour: number,
  endHour: number,
): Gap[] {
  const dayFrom = startHour * 60;
  const dayTo = endHour * 60;
  const open = windows
    .map((w) => [minutesOnDay(w.start_at, date), minutesOnDay(w.end_at, date)] as const)
    .map(([from, to]) => [Math.max(from, dayFrom), Math.min(to, dayTo)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  const gaps: Gap[] = [];
  let cursor = dayFrom;
  for (const [from, to] of open) {
    if (from > cursor) gaps.push(toGap(cursor, from, startHour));
    cursor = Math.max(cursor, to);
  }
  if (cursor < dayTo) gaps.push(toGap(cursor, dayTo, startHour));
  return gaps;
}

const toGap = (from: number, to: number, startHour: number): Gap => ({
  top: topOf(from, startHour),
  height: ((to - from) * HOUR_PX) / 60,
});

// -- dragging and clicking -----------------------------------------------------------

/** Minutes after midnight for a vertical position in a column, snapped to the slot length. */
export function minutesAtOffset(offsetPx: number, startHour: number, snap = SNAP_MINUTES): number {
  const raw = startHour * 60 + (offsetPx * 60) / HOUR_PX;
  return Math.round(raw / snap) * snap;
}

export type Column = { key: string; left: number; right: number };

/** The column under a horizontal position, or the nearest one. */
export function columnAt<T extends Column>(x: number, columns: T[]): T | undefined {
  return (
    columns.find((c) => x >= c.left && x < c.right) ??
    [...columns].sort(
      (a, b) =>
        Math.min(Math.abs(x - a.left), Math.abs(x - a.right)) -
        Math.min(Math.abs(x - b.left), Math.abs(x - b.right)),
    )[0]
  );
}

// -- statuses ------------------------------------------------------------------------

export type Status = Schemas["AppointmentStatusEnum"];

/** The moves the server allows (apps/scheduling/models.py TRANSITIONS). It still decides. */
export const NEXT_STATUSES: Record<Status, Status[]> = {
  booked: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_consultation", "cancelled"],
  in_consultation: ["completed"],
  completed: [],
  no_show: [],
  cancelled: [],
};

/** Only an appointment that has not started can be moved. */
export const canMove = (status: Status) => status === "booked" || status === "confirmed";

/** Appointments that still hold the physician's time. */
export const HOLDS_TIME: Status[] = ["booked", "confirmed", "checked_in", "in_consultation"];

/**
 * A visit can be finished only once vitals and a clinical record (a diagnosis or a note)
 * exist for it.
 */
export function canFinish(counts: { vitals: number; records: number }): boolean {
  return counts.vitals > 0 && counts.records > 0;
}

/** The short reference patients are given: a number sign and the first eight characters of the id. */
export function reference(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}
