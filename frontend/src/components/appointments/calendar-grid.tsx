"use client";

import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { type Appointment } from "@/lib/appointments";
import {
  canMove,
  clock,
  columnAt,
  HOUR_PX,
  LAGOS_LABEL,
  minutesAtOffset,
  minutesOnDay,
  placeAppointments,
  SNAP_MINUTES,
  topOf,
  unavailableSpans,
} from "@/lib/calendar";

import { AppointmentCard } from "./appointment-card";

type Span = { start_at: string; end_at: string };

export type GridColumn = {
  /** Physician id (day view) or date (week view). */
  key: string;
  date: string;
  physicianId: string;
  header: ReactNode;
  /** undefined when availability is unknown, in which case nothing is hatched. */
  windows: Span[] | undefined;
  appointments: Appointment[];
};

export type SlotTarget = { physicianId: string; date: string; minutes: number };

type Props = {
  columns: GridColumn[];
  startHour: number;
  endHour: number;
  /** The Lagos day it is now, for the current-time line. */
  today: string;
  now: number;
  canDrag: boolean;
  onOpen: (appointment: Appointment) => void;
  onSlot: (target: SlotTarget) => void;
  onMove: (appointment: Appointment, target: SlotTarget) => void;
};

/** Less than this and a press is a click, not the start of a drag. */
const DRAG_THRESHOLD_PX = 4;

type Drag = {
  appointment: Appointment;
  /** Where inside the card the pointer took hold, so the card's top maps to the drop time. */
  grabY: number;
  startX: number;
  startY: number;
  started: boolean;
  dx: number;
  dy: number;
  target?: SlotTarget;
};

/**
 * The time grid shared by the day view (a column per physician) and the week view (a column
 * per day): hour rows, hatched unavailable time, appointment cards, a current-time line,
 * click-an-empty-slot to book, and drag a card to move it. Dragging is for mouse and pen;
 * touch users, and anyone using a keyboard, move an appointment from its drawer.
 */
export function CalendarGrid({
  columns,
  startHour,
  endHour,
  today,
  now,
  canDrag,
  onOpen,
  onSlot,
  onMove,
}: Props) {
  const bodies = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ columns, startHour, endHour, onMove });
  useEffect(() => {
    latest.current = { columns, startHour, endHour, onMove };
  });

  const height = (endHour - startHour) * HOUR_PX;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  // Created once, so the listeners added on pointer-down are the very ones removed later.
  const handlers = useMemo(() => {
    const update = (next: Drag | null) => {
      dragRef.current = next;
      setDrag(next);
    };

    const targetAt = (current: Drag, x: number, y: number): SlotTarget | undefined => {
      const { columns: cols, startHour: start, endHour: end } = latest.current;
      const rects = cols.flatMap((c) => {
        const body = bodies.current.get(c.key);
        if (!body) return [];
        const r = body.getBoundingClientRect();
        return [{ key: c.key, left: r.left, right: r.right, top: r.top }];
      });
      const hit = columnAt(x, rects);
      const column = cols.find((c) => c.key === hit?.key);
      if (!hit || !column) return undefined;
      const length =
        minutesOnDay(current.appointment.end_at, column.date) -
        minutesOnDay(current.appointment.start_at, column.date);
      const raw = minutesAtOffset(y - current.grabY - hit.top, start);
      // Keep the whole card on the grid.
      const minutes = Math.min(Math.max(raw, start * 60), Math.max(end * 60 - length, start * 60));
      return { physicianId: column.physicianId, date: column.date, minutes };
    };

    const move = (event: globalThis.PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (!current.started && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      update({
        ...current,
        started: true,
        dx,
        dy,
        target: targetAt(current, event.clientX, event.clientY),
      });
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };

    const up = () => {
      stop();
      const current = dragRef.current;
      update(null);
      if (!current?.started) return;
      // The click that follows a drop must not open the drawer.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const { target, appointment } = current;
      if (!target) return;
      const from = minutesOnDay(appointment.start_at, target.date);
      const moved = target.physicianId !== appointment.physician || target.minutes !== from;
      if (moved) latest.current.onMove(appointment, target);
    };

    const cancel = () => {
      stop();
      update(null);
    };

    const start = (appointment: Appointment, event: PointerEvent<HTMLButtonElement>) => {
      const card = event.currentTarget.getBoundingClientRect();
      update({
        appointment,
        grabY: event.clientY - card.top,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        dx: 0,
        dy: 0,
      });
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };

    return { start, stop };
  }, []);

  function begin(appointment: Appointment, event: PointerEvent<HTMLButtonElement>) {
    if (!canDrag || event.button !== 0 || event.pointerType === "touch") return;
    if (!canMove(appointment.status)) return;
    handlers.start(appointment, event);
  }

  // Take the listeners off if the grid goes away mid-drag.
  useEffect(() => handlers.stop, [handlers]);

  const nowIso = new Date(now).toISOString();
  const showLine = columns.some((c) => c.date === today);
  const nowMinutes = minutesOnDay(nowIso, today);
  const lineVisible = showLine && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;

  const placed = useMemo(
    () =>
      new Map(columns.map((c) => [c.key, placeAppointments(c.appointments, c.date, startHour)])),
    [columns, startHour],
  );

  return (
    <div className="border-line bg-surface flex overflow-x-auto rounded-card border">
      {/* time axis */}
      <div className="border-line bg-surface sticky left-0 z-20 w-16 shrink-0 border-r">
        <div className="text-small text-ink-500 border-line flex h-16 items-end justify-center border-b pb-2">
          {LAGOS_LABEL}
        </div>
        <div className="relative" style={{ height }}>
          {hours.slice(0, -1).map((hour) => (
            <span
              key={hour}
              className="text-small text-ink-500 tnum absolute right-2 -translate-y-1/2"
              style={{ top: (hour - startHour) * HOUR_PX || 8 }}
            >
              {clock(hour * 60)}
            </span>
          ))}
          {lineVisible && (
            <span
              data-testid="now-pill"
              className="bg-ink-900 text-surface text-pill tnum absolute right-1 -translate-y-1/2 rounded-pill px-1.5 py-0.5 font-bold"
              style={{ top: topOf(nowMinutes, startHour) }}
            >
              {clock(nowMinutes)}
            </span>
          )}
        </div>
      </div>

      {columns.map((column) => {
        const spans =
          column.windows === undefined
            ? []
            : unavailableSpans(column.windows, column.date, startHour, endHour);
        const isTarget =
          drag?.started &&
          drag.target?.physicianId === column.physicianId &&
          drag.target.date === column.date;
        return (
          <div key={column.key} className="border-line min-w-48 flex-1 border-r last:border-r-0">
            <div className="border-line flex h-16 items-center border-b px-3">{column.header}</div>
            {/* A pointer shortcut: keyboard and screen-reader users book with "New appointment". */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <div
              ref={(element) => {
                if (element) bodies.current.set(column.key, element);
                else bodies.current.delete(column.key);
              }}
              role="group"
              aria-label={`Appointments, ${column.date}`}
              data-column={column.key}
              className="relative cursor-cell"
              style={{
                height,
                backgroundImage: "linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
                backgroundSize: `100% ${HOUR_PX}px`,
              }}
              // A pointer shortcut. Keyboard and screen-reader users book with "New appointment".

              onClick={(event) => {
                if ((event.target as HTMLElement).closest("[data-appointment]")) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const minutes = minutesAtOffset(event.clientY - rect.top, startHour);
                onSlot({ physicianId: column.physicianId, date: column.date, minutes });
              }}
            >
              {spans.map((span) => (
                <div
                  key={span.top}
                  data-testid="unavailable"
                  className="text-small text-ink-500 pointer-events-none absolute inset-x-0 flex items-center justify-center font-semibold tracking-wide uppercase"
                  style={{
                    top: span.top,
                    height: span.height,
                    backgroundImage:
                      "repeating-linear-gradient(135deg, var(--line) 0 1px, transparent 1px 8px)",
                    backgroundColor: "var(--surface-muted)",
                  }}
                >
                  {span.height >= 48 && "Not available"}
                </div>
              ))}

              {column.date === today && lineVisible && (
                <div
                  aria-hidden
                  className="bg-now-line pointer-events-none absolute inset-x-0 z-10 h-px"
                  style={{ top: topOf(nowMinutes, startHour) }}
                />
              )}

              {isTarget && drag?.target && (
                <div
                  aria-hidden
                  data-testid="drop-preview"
                  className="rounded-cal pointer-events-none absolute inset-x-1 z-20 border-2 border-dashed border-blue-600 bg-blue-50/60"
                  style={{
                    top: topOf(drag.target.minutes, startHour),
                    height: Math.max(
                      ((minutesOnDay(drag.appointment.end_at, column.date) -
                        minutesOnDay(drag.appointment.start_at, column.date)) *
                        HOUR_PX) /
                        60,
                      SNAP_MINUTES,
                    ),
                  }}
                />
              )}

              {placed.get(column.key)?.map((p) => (
                <AppointmentCard
                  key={p.appointment.id}
                  appointment={p.appointment}
                  date={column.date}
                  top={p.top}
                  height={p.height}
                  lane={p.lane}
                  lanes={p.lanes}
                  draggable={canDrag && canMove(p.appointment.status)}
                  dragging={drag?.started && drag.appointment.id === p.appointment.id}
                  offset={
                    drag?.started && drag.appointment.id === p.appointment.id
                      ? { x: drag.dx, y: drag.dy }
                      : undefined
                  }
                  onPointerDown={(event) => begin(p.appointment, event)}
                  onOpen={() => {
                    if (!suppressClick.current) onOpen(p.appointment);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
