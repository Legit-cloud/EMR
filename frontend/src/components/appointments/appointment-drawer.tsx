"use client";

import {
  CalendarBlank,
  ClipboardText,
  Clock,
  Receipt,
  Stethoscope,
  UserCircle,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { AllergyPills } from "@/components/chart/allergy-pills";
import { ReasonModal } from "@/components/chart/reason-modal";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Drawer, type DrawerSection } from "@/components/ui/drawer";
import { IconTile } from "@/components/ui/icon-tile";
import { Textarea } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/link-button";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { api, type Schemas, unwrap } from "@/lib/api";
import {
  type Appointment,
  conflictMessage,
  type Physician,
  typeLabel,
  useChangeStatus,
  useRefreshAppointments,
  useReschedule,
} from "@/lib/appointments";
import {
  canFinish,
  canMove,
  clock,
  formatLongDate,
  HOLDS_TIME,
  lagosDateOf,
  minutesOnDay,
  NEXT_STATUSES,
  reference,
} from "@/lib/calendar";
import { useAllergies, useInvoices, usePatient, useVisitRecords } from "@/lib/chart-queries";
import { ageLabel, formatDate, formatMoney, humanise } from "@/lib/format";
import { APPOINTMENT_STATUS, PAYMENT_STATUS } from "@/lib/status-map";

/** The time added by "Extend time". */
const EXTEND_MINUTES = 15;

type Props = {
  appointment: Appointment | null;
  onClose: () => void;
  physicians: Physician[];
  /** Every appointment loaded for the same period, to see whether there is room to extend. */
  neighbours: Appointment[];
  /** Whether the viewer's role works appointments; the API still decides. */
  canChange: boolean;
  /** Whether the viewer's role may finish a visit (clinical staff). */
  canFinishVisit: boolean;
  onReschedule: (appointment: Appointment) => void;
};

/**
 * The appointment drawer (docs/DESIGN.md 7.3): the patient and the appointment's status, what
 * is booked, general information and allergies, with the actions for the visit in the footer.
 * Sections on the left switch between the visit, its clinical record and billing.
 */
export function AppointmentDrawer(props: Props) {
  const { appointment, onClose } = props;
  // A fresh drawer for each appointment, so no edit or message carries over.
  return <DrawerBody key={appointment?.id ?? "none"} {...props} onClose={onClose} />;
}

function DrawerBody({
  appointment,
  onClose,
  physicians,
  neighbours,
  canChange,
  canFinishVisit,
  onReschedule,
}: Props) {
  const patientId = appointment?.patient ?? "";
  const patient = usePatient(patientId);
  const allergies = useAllergies(patientId);
  const invoices = useInvoices(patientId);
  const records = useVisitRecords(appointment?.encounter_id);
  const [section, setSection] = useState("visit");

  if (!appointment) {
    return (
      <Drawer
        open={false}
        onOpenChange={onClose}
        title="Appointment"
        sections={[{ value: "visit", label: "Visit", icon: CalendarBlank, content: null }]}
      />
    );
  }

  const doctor = physicians.find((p) => p.user === appointment.physician)?.display_name ?? "Doctor";
  const date = lagosDateOf(appointment.start_at);
  const from = clock(minutesOnDay(appointment.start_at, date));
  const to = clock(minutesOnDay(appointment.end_at, date));
  const id = reference(appointment.id);

  const sections: DrawerSection[] = [
    {
      value: "visit",
      label: "Visit",
      icon: CalendarBlank,
      content: (
        <VisitSection
          appointment={appointment}
          doctor={doctor}
          date={date}
          range={`${from}–${to}`}
          patient={patient.data}
          allergies={allergies.data?.results}
          invoices={invoices.data?.results}
          neighbours={neighbours}
          canChange={canChange}
          onReschedule={() => onReschedule(appointment)}
        />
      ),
    },
    {
      value: "clinical",
      label: "Clinical record",
      icon: Stethoscope,
      content: <ClinicalSection appointment={appointment} records={records} />,
    },
    {
      value: "billing",
      label: "Billing",
      icon: Receipt,
      content: <BillingSection invoices={invoices.data?.results} denied={invoices.isError} />,
    },
  ];

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Appointment ${id}`}
      heading={
        <span className="flex flex-wrap items-center gap-3">
          <span className="text-base font-bold">
            Appointment <span className="tnum">{id}</span>
          </span>
          <span className="text-pill bg-blue-100 text-blue-600 rounded-tag px-2 py-1 font-bold uppercase">
            {typeLabel(appointment.appointment_type)}
          </span>
        </span>
      }
      sections={sections}
      section={section}
      onSectionChange={setSection}
      footer={
        <DrawerFooter
          appointment={appointment}
          records={records}
          canFinishVisit={canFinishVisit}
          onDone={onClose}
        />
      }
    />
  );
}

// -- the visit section ---------------------------------------------------------------------

function VisitSection({
  appointment,
  doctor,
  date,
  range,
  patient,
  allergies,
  invoices,
  neighbours,
  canChange,
  onReschedule,
}: {
  appointment: Appointment;
  doctor: string;
  date: string;
  range: string;
  patient: Schemas["Patient"] | undefined;
  allergies: Schemas["Allergy"][] | undefined;
  invoices: Schemas["Invoice"][] | undefined;
  neighbours: Appointment[];
  canChange: boolean;
  onReschedule: () => void;
}) {
  const toast = useToast();
  const change = useChangeStatus();
  const refresh = useRefreshAppointments();
  const move = useReschedule();
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editingReason, setEditingReason] = useState(false);
  const [reason, setReason] = useState(appointment.reason ?? "");

  const next = NEXT_STATUSES[appointment.status];
  const roomToExtend = canChange && canMove(appointment.status) && hasRoom(appointment, neighbours);
  const bill = invoices?.[0];

  async function setStatus(status: Schemas["AppointmentStatusEnum"], cancellation_reason?: string) {
    setProblem(null);
    try {
      await change.mutateAsync({ id: appointment.id, status, cancellation_reason });
    } catch (failure) {
      return setProblem(conflictMessage(failure));
    }
    toast({ title: `Marked ${APPOINTMENT_STATUS[status].label.toLowerCase()}`, tone: "success" });
  }

  async function extend() {
    setProblem(null);
    const end = new Date(Date.parse(appointment.end_at) + EXTEND_MINUTES * 60_000).toISOString();
    try {
      await move.mutateAsync({ id: appointment.id, start_at: appointment.start_at, end_at: end });
    } catch (failure) {
      return setProblem(conflictMessage(failure, doctor));
    }
    toast({ title: `Extended by ${EXTEND_MINUTES} minutes`, tone: "success" });
  }

  const saveReason = useMutation({
    mutationFn: (text: string) =>
      unwrap(
        api.PATCH("/api/scheduling/appointments/{id}/", {
          params: { path: { id: appointment.id } },
          body: { reason: text },
        }),
      ),
    onSuccess: () => {
      setEditingReason(false);
      return refresh();
    },
    meta: { quietErrors: true },
  });

  const name = appointment.patient_name;
  const status = APPOINTMENT_STATUS[appointment.status];

  return (
    <div className="flex flex-col gap-5">
      {problem && <Banner tone="danger" live title={problem} />}

      <section
        aria-label="Patient"
        className="rounded-card border-line flex flex-col gap-3 border p-4"
      >
        <div className="flex items-center gap-3">
          <Avatar name={name} size={40} />
          <div className="min-w-0 flex-1">
            <Link
              href={`/patients/${appointment.patient}`}
              className="text-card-title text-ink-900 block truncate hover:underline"
            >
              {name}
            </Link>
            <p className="text-small text-ink-600 font-mono">{appointment.patient_mrn}</p>
          </div>
          {canChange && next.length > 0 ? (
            <Select
              label="Status"
              hideLabel
              value={appointment.status}
              onValueChange={(value) => {
                const to = value as Schemas["AppointmentStatusEnum"];
                if (to === "cancelled") setCancelling(true);
                else void setStatus(to);
              }}
              options={[appointment.status, ...next].map((value) => ({
                value,
                label: APPOINTMENT_STATUS[value].label,
              }))}
              className="w-44"
            />
          ) : (
            <StatusPill status={status} />
          )}
        </div>
        {editingReason ? (
          <div className="flex flex-col gap-2">
            <Textarea
              label="Reason for the visit"
              rows={2}
              maxLength={500}
              showCount
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button loading={saveReason.isPending} onClick={() => saveReason.mutate(reason)}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditingReason(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-body text-ink-600">
            {appointment.reason || "No reason given."}{" "}
            {canChange && (
              <Button variant="ghost" onClick={() => setEditingReason(true)}>
                Edit
              </Button>
            )}
          </p>
        )}
        {appointment.status === "cancelled" && appointment.cancellation_reason && (
          <p className="text-small text-pink-text">Cancelled: {appointment.cancellation_reason}</p>
        )}
      </section>

      {roomToExtend && (
        <Banner
          title="Time slot available later, you can extend the appointment time"
          action={
            <Button variant="ghost" loading={move.isPending} onClick={extend}>
              Extend time
            </Button>
          }
        />
      )}

      <ul aria-label="Appointment details" className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon={Stethoscope}
          tone="blue"
          label="Service"
          value={typeLabel(appointment.appointment_type)}
        />
        <Tile icon={Clock} tone="teal" label={formatLongDate(date)} value={range} />
        <Tile icon={UserCircle} tone="purple" label="Physician" value={doctor} />
      </ul>

      {canChange && canMove(appointment.status) && (
        <div>
          <Button variant="outline" onClick={onReschedule}>
            Reschedule
          </Button>
        </div>
      )}

      {bill && (
        <section
          aria-label="Payment"
          className="rounded-card border-line flex flex-wrap items-center gap-3 border p-4"
        >
          <span className="text-small text-ink-600">Payment</span>
          <Link
            href={`/invoices/${bill.id}`}
            className="text-small font-semibold text-blue-600 hover:underline"
          >
            Bill {reference(bill.id)}
          </Link>
          <StatusPill status={PAYMENT_STATUS[bill.payment_status]} />
          <span className="text-body text-ink-900 tnum ml-auto font-semibold">
            {formatMoney(bill.net_due_minor, bill.currency)} due
          </span>
        </section>
      )}

      <section aria-labelledby="general-info" className="flex flex-col gap-3">
        <h3 id="general-info" className="text-card-title text-ink-900">
          General information
        </h3>
        {patient ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Info label="Full name" value={name} />
            <Info label="Phone" value={patient.phone || "—"} />
            <Info
              label="Age and date of birth"
              value={`${ageLabel(patient.date_of_birth)} · ${formatDate(patient.date_of_birth)}`}
            />
            <Info label="Email" value={patient.email || "—"} />
            <Info label="Gender" value={humanise(patient.sex ?? "unknown")} />
            <Info
              label="Address"
              value={
                [patient.address_line, patient.city, patient.state].filter(Boolean).join(", ") ||
                "—"
              }
            />
          </dl>
        ) : (
          <p className="text-small text-ink-600">Patient details are not available to your role.</p>
        )}
        {allergies && allergies.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-label-caps text-ink-500 uppercase">Allergies</span>
            <AllergyPills allergies={allergies} />
          </div>
        )}
      </section>

      <ReasonModal
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this appointment"
        explanation="The patient is not told automatically. The reason stays with the appointment."
        reasonLabel="Reason for cancelling"
        confirmLabel="Cancel appointment"
        onConfirm={(text) => void setStatus("cancelled", text)}
      />
    </div>
  );
}

/** Whether the physician has nothing booked in the slot after this appointment ends. */
function hasRoom(appointment: Appointment, neighbours: Appointment[]): boolean {
  const end = Date.parse(appointment.end_at);
  const newEnd = end + EXTEND_MINUTES * 60_000;
  return !neighbours.some(
    (other) =>
      other.id !== appointment.id &&
      other.physician === appointment.physician &&
      HOLDS_TIME.includes(other.status) &&
      Date.parse(other.start_at) < newEnd &&
      Date.parse(other.end_at) > end,
  );
}

function Tile({
  icon,
  tone,
  label,
  value,
}: {
  icon: typeof Clock;
  tone: "blue" | "teal" | "purple";
  label: string;
  value: string;
}) {
  return (
    <li className="rounded-card bg-surface-muted flex items-center gap-3 p-3">
      <IconTile icon={icon} tone={tone} size={36} />
      <span className="flex min-w-0 flex-col">
        <span className="text-small text-ink-500 truncate">{label}</span>
        <span className="text-body text-ink-900 truncate font-semibold">{value}</span>
      </span>
    </li>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-label-caps text-ink-500 uppercase">{label}</dt>
      <dd className="text-body text-ink-900 font-semibold break-words">{value}</dd>
    </div>
  );
}

// -- clinical record and billing sections ----------------------------------------------------

type Records = ReturnType<typeof useVisitRecords>;

function ClinicalSection({ appointment, records }: { appointment: Appointment; records: Records }) {
  if (!appointment.encounter_id) {
    return (
      <p className="text-body text-ink-600">
        The clinical record opens when the consultation starts.
      </p>
    );
  }
  if (!records.known) {
    return (
      <p className="text-body text-ink-600">
        {records.loading
          ? "Loading the clinical record…"
          : "The clinical record is not available to your role."}
      </p>
    );
  }
  const rows = [
    { label: "Vital signs recorded", count: records.vitals, tab: "vitals" },
    { label: "Diagnoses", count: records.diagnoses, tab: "diagnoses" },
    { label: "Consultation notes", count: records.notes, tab: "notes" },
  ];
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.label} className="rounded-card border-line flex items-center gap-3 border p-4">
          <IconTile icon={ClipboardText} tone={row.count > 0 ? "green" : "grey"} size={36} />
          <span className="text-body text-ink-900 flex-1 font-semibold">{row.label}</span>
          <span className="text-kpi-sm text-ink-900 tnum">{row.count}</span>
          <Link
            href={`/patients/${appointment.patient}?tab=${row.tab}`}
            className="text-small font-semibold text-blue-600 hover:underline"
          >
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BillingSection({
  invoices,
  denied,
}: {
  invoices: Schemas["Invoice"][] | undefined;
  denied: boolean;
}) {
  if (denied)
    return <p className="text-body text-ink-600">Billing is not available to your role.</p>;
  if (!invoices) return <p className="text-body text-ink-600">Loading bills…</p>;
  if (invoices.length === 0)
    return <p className="text-body text-ink-600">No bills for this patient.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {invoices.map((invoice) => (
        <li
          key={invoice.id}
          className="rounded-card border-line flex items-center gap-3 border p-4"
        >
          <Link
            href={`/invoices/${invoice.id}`}
            className="text-body font-semibold text-blue-600 hover:underline"
          >
            Bill {reference(invoice.id)}
          </Link>
          <StatusPill status={PAYMENT_STATUS[invoice.payment_status]} />
          <span className="text-body text-ink-900 tnum ml-auto font-semibold">
            {formatMoney(invoice.net_due_minor, invoice.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// -- footer --------------------------------------------------------------------------------------

function DrawerFooter({
  appointment,
  records,
  canFinishVisit,
  onDone,
}: {
  appointment: Appointment;
  records: Records;
  canFinishVisit: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const change = useChangeStatus();
  const [problem, setProblem] = useState<string | null>(null);
  const inConsultation = appointment.status === "in_consultation";
  const ready =
    records.known &&
    canFinish({ vitals: records.vitals, records: records.diagnoses + records.notes });
  const chart = `/patients/${appointment.patient}`;

  async function finish() {
    setProblem(null);
    try {
      await change.mutateAsync({ id: appointment.id, status: "completed" });
    } catch (failure) {
      return setProblem(conflictMessage(failure));
    }
    toast({ title: "Visit finished", tone: "success" });
    onDone();
  }

  const helper = !canFinishVisit
    ? "Only clinical staff can finish a visit."
    : !inConsultation
      ? "The visit can be finished once the consultation has started."
      : !records.known
        ? "Checking the clinical record…"
        : !ready
          ? "Please add vitals and a clinical record to finish this visit."
          : null;

  return (
    <div className="flex flex-col gap-3">
      {problem && <Banner tone="danger" live title={problem} />}
      <div className="flex flex-wrap items-center gap-3">
        {inConsultation ? (
          <LinkButton variant="success" href={`${chart}?tab=vitals`}>
            Edit Medical Checkup
          </LinkButton>
        ) : (
          <Button variant="success" disabled>
            Edit Medical Checkup
          </Button>
        )}
        {inConsultation ? (
          <LinkButton variant="dashed" href={`${chart}?tab=notes`}>
            Add Medical Record
          </LinkButton>
        ) : (
          <Button variant="dashed" disabled>
            Add Medical Record
          </Button>
        )}
        <Button
          variant="neutral"
          className="ml-auto"
          disabled={!(canFinishVisit && inConsultation && ready)}
          loading={change.isPending}
          onClick={finish}
        >
          Finish
        </Button>
      </div>
      {helper && <p className="text-small text-ink-600">{helper}</p>}
    </div>
  );
}
