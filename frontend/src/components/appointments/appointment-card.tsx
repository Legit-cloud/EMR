"use client";

import type { PointerEvent } from "react";

import { type Appointment, typeLabel } from "@/lib/appointments";
import { clock, minutesOnDay } from "@/lib/calendar";
import { cx } from "@/lib/cx";
import { APPOINTMENT_STATUS, TONES } from "@/lib/status-map";

type Props = {
  appointment: Appointment;
  /** The day the card is drawn on, to turn its times into clock times. */
  date: string;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  dragging?: boolean;
  /** Pixels the card has been dragged, while a drag is in progress. */
  offset?: { x: number; y: number };
  draggable: boolean;
  onOpen: () => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
};

/**
 * One appointment on the calendar: tinted by status (docs/DESIGN.md 2.4), with the status
 * icon, patient, time range, status text and a service tag. The status is text and an icon as
 * well as a colour.
 */
export function AppointmentCard({
  appointment,
  date,
  top,
  height,
  lane,
  lanes,
  dragging = false,
  offset,
  draggable,
  onOpen,
  onPointerDown,
}: Props) {
  const status = APPOINTMENT_STATUS[appointment.status];
  const tone = TONES[status.tone];
  const Glyph = status.icon;
  const from = clock(minutesOnDay(appointment.start_at, date));
  const to = clock(minutesOnDay(appointment.end_at, date));
  const roomy = height >= 72;
  const width = 100 / lanes;
  return (
    <button
      type="button"
      data-appointment={appointment.id}
      onClick={onOpen}
      onPointerDown={onPointerDown}
      aria-label={`${appointment.patient_name}, ${from} to ${to}, ${status.label}`}
      style={{
        top,
        height,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
      }}
      className={cx(
        "rounded-cal absolute flex flex-col gap-0.5 overflow-hidden p-2 text-left transition-shadow duration-150",
        tone.card,
        draggable && "cursor-grab touch-none",
        dragging && "shadow-pop z-30 cursor-grabbing opacity-90",
        !dragging && "hover:shadow-card focus-visible:ring-2 focus-visible:ring-blue-600",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="bg-surface grid size-5 shrink-0 place-items-center rounded-full"
        >
          <Glyph size={12} weight="fill" className={tone.icon} />
        </span>
        <span className="text-small text-ink-900 min-w-0 flex-1 truncate font-semibold">
          {appointment.patient_name}
        </span>
      </span>
      <span className="text-small text-ink-600 tnum truncate">
        {from}–{to}
      </span>
      <span className={cx("text-small flex items-center gap-1.5 font-semibold", tone.text)}>
        <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", tone.dot)} />
        <span className="truncate">{status.label}</span>
      </span>
      {roomy && (
        <span className="bg-surface text-small text-ink-600 mt-auto w-fit max-w-full truncate rounded-pill px-2 py-0.5">
          {typeLabel(appointment.appointment_type)}
        </span>
      )}
    </button>
  );
}
