"use client";

import { CalendarPlus, Clock, UserCircle } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { api, type Schemas, unwrap } from "@/lib/api";
import {
  APPOINTMENT_TYPES,
  conflictMessage,
  type Physician,
  useDepartments,
  useFacilities,
  usePatientSearch,
  useRefreshAppointments,
} from "@/lib/appointments";
import { addDays, clock, instantAt, SNAP_MINUTES } from "@/lib/calendar";
import { lagosToday } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";

const STEPS = [
  { label: "Visit", icon: CalendarPlus },
  { label: "Patient", icon: UserCircle },
];

const FORM_ID = "booking-form";

/** Where a click on the calendar was, so the wizard opens with it filled in. */
export type BookingStart = { physicianId?: string; date?: string; minutes?: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  physicians: Physician[];
  initial: BookingStart;
};

type Chosen = Pick<Schemas["PatientList"], "id" | "first_name" | "last_name" | "mrn">;

/** "09:15" typed into a time field to minutes after midnight, or null. */
export function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null;
}

/**
 * The booking wizard (docs/DESIGN.md 7.4): the visit (type, physician, date and time, reason),
 * then the patient. Opened from an empty calendar slot it starts with that physician and
 * time. Whether the time is free is the server's to say; a refusal is shown in words.
 */
export function BookingWizard(props: Props) {
  // A fresh form each time it opens, so it never keeps the last booking's details.
  return props.open ? <Wizard key={JSON.stringify(props.initial)} {...props} /> : null;
}

function Wizard({ onOpenChange, physicians, initial }: Props) {
  const toast = useToast();
  const refresh = useRefreshAppointments();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<Schemas["AppointmentTypeEnum"]>("new");
  const [physician, setPhysician] = useState(initial.physicianId ?? physicians[0]?.user ?? "");
  const [date, setDate] = useState(initial.date ?? addDays(lagosToday(), 0));
  const [start, setStart] = useState(initial.minutes === undefined ? "" : clock(initial.minutes));
  const [end, setEnd] = useState(
    initial.minutes === undefined ? "" : clock(initial.minutes + SNAP_MINUTES),
  );
  const [facility, setFacility] = useState("");
  const [department, setDepartment] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState<Chosen | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const facilities = useFacilities();
  const facilityId = facility || facilities.data?.[0]?.id || "";
  const departments = useDepartments(facilityId);
  // Until one is picked, the first department is used: a booking with none is outside the
  // scope of a doctor who works in a department.
  const departmentId = department ?? departments.data?.[0]?.id ?? "none";
  const term = useDebounced(search.trim(), 250);
  const matches = usePatientSearch(term);

  const startMinutes = parseTime(start);
  const endMinutes = end ? parseTime(end) : null;
  const errors = {
    physician: physician ? undefined : "Choose a physician.",
    date: date ? undefined : "Choose a date.",
    start: startMinutes === null ? "Enter the start time." : undefined,
    end:
      end && (endMinutes === null || (startMinutes !== null && endMinutes <= startMinutes))
        ? "The end must be after the start."
        : undefined,
  };
  const stepOneValid = !errors.physician && !errors.date && !errors.start && !errors.end;

  const book = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/scheduling/appointments/", {
          body: {
            patient: patient!.id,
            physician,
            facility: facilityId,
            department: departmentId === "none" ? null : departmentId,
            appointment_type: type,
            start_at: instantAt(date, startMinutes!),
            end_at: endMinutes === null ? undefined : instantAt(date, endMinutes),
            reason,
          },
        }),
      ),
    meta: { quietErrors: true },
  });

  const doctorName = physicians.find((p) => p.user === physician)?.display_name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (step === 0) {
      if (stepOneValid) setStep(1);
      return;
    }
    if (!patient) return;
    try {
      await book.mutateAsync();
    } catch (failure) {
      setStep(0);
      return setProblem(conflictMessage(failure, doctorName));
    }
    toast({
      title: "Appointment booked",
      description: `${patient.first_name} ${patient.last_name}, ${start}`,
      tone: "success",
    });
    await refresh();
    onOpenChange(false);
  }

  const patientOptions = [
    ...(patient ? [patient] : []),
    ...(matches.data ?? []).filter((p) => p.id !== patient?.id),
  ].map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name} · ${p.mrn}` }));

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="New appointment"
      header={<Stepper steps={STEPS} current={step} />}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <>
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep(0)}>
                  Previous
                </Button>
              )}
              <Button type="submit" form={FORM_ID} loading={book.isPending}>
                {step === 0 ? "Next" : "Book appointment"}
              </Button>
            </>
          }
        />
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}

        {step === 0 && (
          <fieldset className="flex flex-col gap-4">
            <legend className="sr-only">The visit</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Service"
                value={type}
                onValueChange={(v) => setType(v as Schemas["AppointmentTypeEnum"])}
                options={APPOINTMENT_TYPES}
              />
              <Select
                label="Physician"
                value={physician}
                onValueChange={setPhysician}
                options={physicians.map((p) => ({ value: p.user, label: p.display_name }))}
                error={submitted ? errors.physician : undefined}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Date"
                type="date"
                min={lagosToday()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                error={submitted ? errors.date : undefined}
              />
              <Input
                label="Start time"
                type="time"
                icon={Clock}
                step={SNAP_MINUTES * 60}
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  // Keep the usual length until the end has been chosen by hand.
                  const minutes = parseTime(e.target.value);
                  if (minutes !== null) setEnd(clock(minutes + SNAP_MINUTES));
                }}
                error={submitted ? errors.start : undefined}
              />
              <Input
                label="End time"
                type="time"
                icon={Clock}
                step={SNAP_MINUTES * 60}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                error={submitted ? errors.end : undefined}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Facility"
                value={facilityId}
                onValueChange={(v) => {
                  setFacility(v);
                  setDepartment(null);
                }}
                options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
              />
              <Select
                label="Department"
                value={departmentId}
                onValueChange={setDepartment}
                options={[
                  { value: "none", label: "None" },
                  ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            </div>
            <Textarea
              label="Quick note"
              optional
              rows={2}
              maxLength={500}
              showCount
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </fieldset>
        )}

        {step === 1 && (
          <fieldset className="flex flex-col gap-4">
            <legend className="sr-only">The patient</legend>
            <Combobox
              label="Find patient"
              placeholder="Name or MRN"
              options={patientOptions}
              value={patient?.id ?? null}
              onValueChange={(id) => {
                const found = matches.data?.find((p) => p.id === id);
                setPatient(id ? (found ?? patient) : null);
              }}
              onQueryChange={setSearch}
              searching={matches.isFetching}
              emptyText={term.length < 2 ? "Type at least two letters" : "No patients found"}
              error={submitted && !patient ? "Choose the patient to book." : undefined}
            />
            {patient && (
              <div className="rounded-card bg-surface-muted flex items-center gap-3 p-3">
                <Avatar name={`${patient.first_name} ${patient.last_name}`} size={40} />
                <div>
                  <p className="text-body text-ink-900 font-semibold">
                    {patient.first_name} {patient.last_name}
                  </p>
                  <p className="text-small text-ink-600 font-mono">{patient.mrn}</p>
                </div>
              </div>
            )}
            <p className="text-small text-ink-600">
              Booking {doctorName ?? "a physician"} on {date} at {start}. A patient who is not
              registered yet is registered first, from Patients.
            </p>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
