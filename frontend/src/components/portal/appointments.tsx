"use client";

import { type FormEvent, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format";
import {
  type PortalAppointment,
  type PortalSlot,
  refusalMessage,
  useAppointments,
  useBook,
  useCancel,
  useSlots,
} from "@/lib/portal";
import { APPOINTMENT_STATUS, TONES } from "@/lib/status-map";

import { PortalButton, PortalCard, PortalHeading, QueryState } from "./shared";

const isUpcoming = (a: PortalAppointment) =>
  (a.status === "booked" || a.status === "confirmed") && Date.parse(a.start_at) > Date.now();

/** Visits: book a free time, see what is coming up and cancel with a reason. */
export function PortalAppointments() {
  const appointments = useAppointments();
  const [booking, setBooking] = useState(false);
  const [cancelling, setCancelling] = useState<PortalAppointment | null>(null);

  return (
    <>
      <PortalHeading title="Appointments" lead="Your visits to the clinic." />
      <div className="mb-4">
        <PortalButton onClick={() => setBooking(true)}>Book a visit</PortalButton>
      </div>
      <QueryState query={appointments} what="appointments" empty="You have no appointments yet.">
        {(rows) => {
          const coming = rows.filter(isUpcoming);
          const past = rows.filter((a) => !isUpcoming(a));
          return (
            <div className="flex flex-col gap-5">
              <Group
                title="Coming up"
                rows={coming}
                none="Nothing is booked."
                onCancel={setCancelling}
              />
              <Group
                title="Past visits"
                rows={past}
                none="No past visits."
                onCancel={setCancelling}
              />
            </div>
          );
        }}
      </QueryState>
      <BookDialog open={booking} onOpenChange={setBooking} />
      <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}

function Group({
  title,
  rows,
  none,
  onCancel,
}: {
  title: string;
  rows: PortalAppointment[];
  none: string;
  onCancel: (a: PortalAppointment) => void;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-card-title text-ink-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-body text-ink-600">{none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => (
            <li key={a.id}>
              <PortalCard>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-body text-ink-900 font-bold">{formatDateTime(a.start_at)}</p>
                  <StatusPill status={APPOINTMENT_STATUS[a.status]} />
                </div>
                <p className="text-body text-ink-600">
                  {a.doctor_name}, {a.specialty}
                </p>
                <p className="text-body text-ink-600">{a.location}</p>
                {a.reason && <p className="text-body text-ink-900">For: {a.reason}</p>}
                {a.can_cancel && (
                  <div>
                    <PortalButton
                      variant="outline"
                      aria-label={`Cancel the visit on ${formatDateTime(a.start_at)}`}
                      onClick={() => onCancel(a)}
                    >
                      Cancel this visit
                    </PortalButton>
                  </div>
                )}
              </PortalCard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BookDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // A fresh form each time it opens.
  return <BookForm key={open ? "open" : "closed"} open={open} onOpenChange={onOpenChange} />;
}

function BookForm({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const slots = useSlots(open);
  const book = useBook();
  const [slot, setSlot] = useState<PortalSlot | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (!slot || reason.trim().length < 3) return;
    try {
      await book.mutateAsync({ slot: slot.id, reason: reason.trim() });
    } catch (failure) {
      setSlot(null);
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Visit booked", description: formatDateTime(slot.start_at), tone: "success" });
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Book a visit"
      description="Choose a time that suits you."
      footer={
        <ModalFooter
          start={
            <PortalButton variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </PortalButton>
          }
          end={
            <PortalButton type="submit" form="portal-book" loading={book.isPending}>
              Book this visit
            </PortalButton>
          }
        />
      }
    >
      <form id="portal-book" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body text-ink-900 mb-1 font-semibold">Available times</legend>
          {slots.isPending ? (
            <p role="status" className="text-body text-ink-600">
              Looking for free times…
            </p>
          ) : slots.isError ? (
            <p role="alert" className="text-body text-ink-600">
              Free times could not be loaded. Try again later.
            </p>
          ) : slots.data.length === 0 ? (
            <p className="text-body text-ink-600">
              There are no free times right now. Please call us.
            </p>
          ) : (
            slots.data.map((s) => (
              <label
                key={s.id}
                className="rounded-control border-line has-[:checked]:border-blue-600 has-[:checked]:bg-blue-100 flex min-h-11 cursor-pointer items-center gap-3 border p-3"
              >
                <input
                  type="radio"
                  name="slot"
                  checked={slot?.id === s.id}
                  onChange={() => setSlot(s)}
                  className="size-5 accent-blue-600"
                />
                <span className="text-body text-ink-900">{slotText(s)}</span>
              </label>
            ))
          )}
          {submitted && !slot && (
            <p role="alert" className={cx("text-small", TONES.pink.text)}>
              Choose a time.
            </p>
          )}
        </fieldset>
        <Input
          label="What is the visit for?"
          value={reason}
          maxLength={200}
          error={
            submitted && reason.trim().length < 3
              ? "Tell us briefly why you are coming."
              : undefined
          }
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function CancelDialog({
  appointment,
  onClose,
}: {
  appointment: PortalAppointment | null;
  onClose: () => void;
}) {
  return <CancelForm key={appointment?.id ?? "none"} appointment={appointment} onClose={onClose} />;
}

function CancelForm({
  appointment,
  onClose,
}: {
  appointment: PortalAppointment | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const cancel = useCancel(appointment?.id ?? "none");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (reason.trim().length < 3) return;
    try {
      await cancel.mutateAsync({ reason: reason.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Visit cancelled", tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={appointment !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Cancel this visit?"
      description={appointment ? formatDateTime(appointment.start_at) : undefined}
      size="confirm"
      footer={
        <ModalFooter
          start={
            <PortalButton variant="ghost" onClick={onClose}>
              Keep my visit
            </PortalButton>
          }
          end={
            <PortalButton type="submit" form="portal-cancel" loading={cancel.isPending}>
              Cancel visit
            </PortalButton>
          }
        />
      }
    >
      <form id="portal-cancel" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label="Why are you cancelling?"
          value={reason}
          maxLength={200}
          error={
            submitted && reason.trim().length < 3 ? "Tell us why you are cancelling." : undefined
          }
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  );
}

/** "Sat, 24 Oct 2026, 09:30 · Dr Ada Okafor, Cardiology" */
const slotText = (s: PortalSlot) =>
  `${formatDateTime(s.start_at)} · ${s.doctor_name}, ${s.specialty}`;
