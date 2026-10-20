/**
 * The one place status colours and icons are defined (docs/DESIGN.md Section 2.4).
 * Components look statuses up here; none defines its own status colours.
 */
import {
  Bed,
  Broom,
  CalendarCheck,
  CheckCircle,
  CheckSquare,
  CircleHalf,
  ClockCountdown,
  DoorOpen,
  Hourglass,
  type Icon,
  Info,
  Minus,
  Prohibit,
  Receipt,
  Siren,
  Stethoscope,
  User,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";

import type { Schemas } from "@/lib/api";

export type Tone = "blue" | "sky" | "teal" | "purple" | "green" | "amber" | "pink" | "grey";

type ToneSpec = {
  /** Token names, so tests can check the contrast of the real values. */
  tokens: { text: string; tint: string; solid: string };
  /** Status text on white or on the tint. */
  text: string;
  /** Tint fill alone: icon tiles and tinted surfaces. */
  tint: string;
  /** Status pill and table tag: tint fill, text-safe text. */
  pill: string;
  /** Calendar card: tint fill and a 1 px border at 40% of the solid. */
  card: string;
  /** Leading dot and icons on tinted tiles: the solid colour, never for text. */
  dot: string;
  icon: string;
};

// Class names are written out in full so Tailwind can find them.
export const TONES: Record<Tone, ToneSpec> = {
  blue: {
    tokens: { text: "blue-600", tint: "blue-100", solid: "blue-600" },
    text: "text-blue-600",
    tint: "bg-blue-100",
    pill: "bg-blue-100 text-blue-600",
    card: "bg-blue-100 border border-blue-600/40",
    dot: "bg-blue-600",
    icon: "text-blue-600",
  },
  sky: {
    tokens: { text: "sky-text", tint: "sky-tint", solid: "sky" },
    text: "text-sky-text",
    tint: "bg-sky-tint",
    pill: "bg-sky-tint text-sky-text",
    card: "bg-sky-tint border border-sky/40",
    dot: "bg-sky",
    icon: "text-sky",
  },
  teal: {
    tokens: { text: "teal-text", tint: "teal-tint", solid: "teal" },
    text: "text-teal-text",
    tint: "bg-teal-tint",
    pill: "bg-teal-tint text-teal-text",
    card: "bg-teal-tint border border-teal/40",
    dot: "bg-teal",
    icon: "text-teal",
  },
  purple: {
    tokens: { text: "purple-text", tint: "purple-tint", solid: "purple" },
    text: "text-purple-text",
    tint: "bg-purple-tint",
    pill: "bg-purple-tint text-purple-text",
    card: "bg-purple-tint border border-purple/40",
    dot: "bg-purple",
    icon: "text-purple",
  },
  green: {
    tokens: { text: "green-text", tint: "green-tint", solid: "green" },
    text: "text-green-text",
    tint: "bg-green-tint",
    pill: "bg-green-tint text-green-text",
    card: "bg-green-tint border border-green/40",
    dot: "bg-green",
    icon: "text-green",
  },
  amber: {
    tokens: { text: "amber-text", tint: "amber-tint", solid: "amber" },
    text: "text-amber-text",
    tint: "bg-amber-tint",
    pill: "bg-amber-tint text-amber-text",
    card: "bg-amber-tint border border-amber/40",
    dot: "bg-amber",
    icon: "text-amber",
  },
  pink: {
    tokens: { text: "pink-text", tint: "pink-tint", solid: "pink" },
    text: "text-pink-text",
    tint: "bg-pink-tint",
    pill: "bg-pink-tint text-pink-text",
    card: "bg-pink-tint border border-pink/40",
    dot: "bg-pink",
    icon: "text-pink",
  },
  grey: {
    tokens: { text: "ink-600", tint: "pill-grey", solid: "ink-400" },
    text: "text-ink-600",
    tint: "bg-pill-grey",
    pill: "bg-pill-grey text-ink-600",
    card: "bg-pill-grey border border-ink-400/40",
    dot: "bg-ink-400",
    icon: "text-ink-400",
  },
};

export type StatusSpec = { label: string; tone: Tone; icon: Icon };

export const APPOINTMENT_STATUS: Record<Schemas["AppointmentStatusEnum"], StatusSpec> = {
  booked: { label: "Booked", tone: "sky", icon: Hourglass },
  confirmed: { label: "Confirmed", tone: "blue", icon: CalendarCheck },
  checked_in: { label: "Checked-In", tone: "teal", icon: DoorOpen },
  in_consultation: { label: "In-Consultation", tone: "purple", icon: Stethoscope },
  completed: { label: "Completed", tone: "green", icon: CheckSquare },
  no_show: { label: "No-Show", tone: "amber", icon: ClockCountdown },
  cancelled: { label: "Cancelled", tone: "pink", icon: XCircle },
};

export const PAYMENT_STATUS: Record<Schemas["PaymentStatusEnum"], StatusSpec> = {
  paid: { label: "Paid", tone: "green", icon: CheckCircle },
  partially_paid: { label: "Partially paid", tone: "amber", icon: CircleHalf },
  unpaid: { label: "Unpaid", tone: "pink", icon: Receipt },
};

/**
 * Triage levels as named in DESIGN.md. The API stores a priority from 1 (most urgent) to 5;
 * how those numbers map onto these levels is a clinical decision still to be made.
 */
export type TriageLevel = "emergency" | "urgent" | "routine" | "non_urgent";

export const TRIAGE_LEVEL: Record<TriageLevel, StatusSpec> = {
  emergency: { label: "Emergency", tone: "pink", icon: Siren },
  urgent: { label: "Urgent", tone: "amber", icon: WarningCircle },
  routine: { label: "Routine", tone: "sky", icon: Info },
  non_urgent: { label: "Non-urgent", tone: "grey", icon: Minus },
};

/** Bed states for the Release 2 inpatient module; there is no bed API yet. */
export type BedStatus = "vacant" | "occupied" | "cleaning" | "out_of_service";

export const BED_STATUS: Record<BedStatus, StatusSpec> = {
  vacant: { label: "Vacant", tone: "green", icon: Bed },
  occupied: { label: "Occupied", tone: "sky", icon: User },
  cleaning: { label: "Cleaning", tone: "amber", icon: Broom },
  out_of_service: { label: "Out of service", tone: "grey", icon: Prohibit },
};

/** Stock level of one drug (DESIGN.md Section 2.2: amber low stock, pink out of stock). */
export const STOCK_LEVEL = {
  low: { label: "Low", tone: "amber", icon: WarningCircle },
  out: { label: "Out", tone: "pink", icon: XCircle },
} as const satisfies Record<string, StatusSpec>;

/** Patient register status. Grey for both ends of "not currently attending"; the label says which. */
export const PATIENT_STATUS: Record<Schemas["PatientStatusEnum"], StatusSpec> = {
  active: { label: "Active", tone: "green", icon: CheckCircle },
  inactive: { label: "Inactive", tone: "grey", icon: Minus },
  deceased: { label: "Deceased", tone: "grey", icon: Prohibit },
};
