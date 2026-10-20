"use client";

import { Clock } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  type Appointment,
  conflictMessage,
  type Physician,
  useReschedule,
} from "@/lib/appointments";
import { clock, instantAt, lagosDateOf, minutesOnDay, SNAP_MINUTES } from "@/lib/calendar";
import { lagosToday } from "@/lib/format";

import { parseTime } from "./booking-wizard";

const FORM_ID = "reschedule-form";

type Props = {
  appointment: Appointment | null;
  physicians: Physician[];
  onClose: () => void;
};

/**
 * Move an appointment by choosing a new day, time and physician. The same as dragging it on the
 * calendar, for keyboards and touch screens.
 */
export function RescheduleDialog(props: Props) {
  return <Form key={props.appointment?.id ?? "none"} {...props} />;
}

function Form({ appointment, physicians, onClose }: Props) {
  const toast = useToast();
  const move = useReschedule();
  const current = appointment ? lagosDateOf(appointment.start_at) : lagosToday();
  const [date, setDate] = useState(current);
  const [start, setStart] = useState(
    appointment ? clock(minutesOnDay(appointment.start_at, current)) : "",
  );
  const [physician, setPhysician] = useState(appointment?.physician ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minutes = parseTime(start);
    if (!appointment || minutes === null || !date)
      return setProblem("Enter the new date and time.");
    setProblem(null);
    const doctor = physicians.find((p) => p.user === physician)?.display_name;
    try {
      await move.mutateAsync({
        id: appointment.id,
        start_at: instantAt(date, minutes),
        physician: physician === appointment.physician ? undefined : physician,
      });
    } catch (failure) {
      return setProblem(conflictMessage(failure, doctor));
    }
    toast({ title: "Appointment moved", description: `${date}, ${start}`, tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={appointment !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Reschedule appointment"
      description={
        appointment ? `${appointment.patient_name}. The patient is told the new time.` : undefined
      }
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={move.isPending}>
              Move appointment
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Select
          label="Physician"
          value={physician}
          onValueChange={setPhysician}
          options={physicians.map((p) => ({ value: p.user, label: p.display_name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Date"
            type="date"
            min={lagosToday()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label="Start time"
            type="time"
            icon={Clock}
            step={SNAP_MINUTES * 60}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}
