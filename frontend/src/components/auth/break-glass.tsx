"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { api, apiError, ApiRequestError, fieldErrors, unwrap } from "@/lib/api";
import { formatTime } from "@/lib/format";

/** The same minimum the API enforces (BREAK_GLASS_MIN_REASON_LENGTH). */
export const MIN_REASON_LENGTH = 15;
const MAX_REASON_LENGTH = 2000;
const PATIENT_RESOURCE = "patients.patient";

export const BANNER_TEXT =
  "You opened this chart outside your normal access. This is being recorded.";

/** The patient to open when the API refused a record with break_glass_available. */
export function breakGlassPatient(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== "break_glass_available") return null;
  const { resource, object_id: id } = error.body.details;
  return resource === PATIENT_RESOURCE && typeof id === "string" ? id : null;
}

/** Status of patient-level break-glass for one chart, and the request to open it. */
export function usePatientBreakGlass(patientId: string) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["break-glass", patientId],
    queryFn: () =>
      unwrap(
        api.GET("/api/accounts/break-glass/patients/{patient_id}/", {
          params: { path: { patient_id: patientId } },
        }),
      ),
  });
  const open = useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST("/api/accounts/break-glass/", {
          body: { resource: PATIENT_RESOURCE, object_id: patientId, reason },
        }),
      ),
    meta: { quietErrors: true },
    // Everything on screen may now include records that were hidden: load it again.
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return { status, open };
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  busy?: boolean;
  /** An error from the API, shown above the reason. */
  error?: string;
};

/** Asks for the clinical reason before opening a chart outside the user's access. */
export function BreakGlassDialog({ open, onOpenChange, onConfirm, busy, error }: DialogProps) {
  const [reason, setReason] = useState("");
  const [tooShort, setTooShort] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setTooShort(true);
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          setTooShort(false);
        }
        onOpenChange(next);
      }}
      title="Open this chart with break-glass"
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="break-glass-form" loading={busy}>
              Open chart
            </Button>
          }
        />
      }
    >
      <form id="break-glass-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-body text-ink-600">
          Some of this patient&apos;s records are outside your normal access. Give the clinical
          reason you need them now. Your access is recorded and reviewed by the compliance team, and
          ends automatically.
        </p>
        {error && <Banner tone="danger" live title={error} />}
        <Textarea
          label="Reason for access"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (tooShort) setTooShort(e.target.value.trim().length < MIN_REASON_LENGTH);
          }}
          maxLength={MAX_REASON_LENGTH}
          showCount
          required
          hint={`At least ${MIN_REASON_LENGTH} characters, for example the emergency you are handling.`}
          error={
            tooShort
              ? `Give a fuller reason (at least ${MIN_REASON_LENGTH} characters).`
              : undefined
          }
        />
      </form>
    </Modal>
  );
}

/** Persistent danger banner while a break-glass grant is open on this chart. */
export function BreakGlassBanner({ expiresAt }: { expiresAt: string }) {
  return (
    <Banner tone="danger" live title={BANNER_TEXT}>
      Your extra access ends at {formatTime(expiresAt)}.
    </Banner>
  );
}

/**
 * The break-glass part of a patient chart: the danger banner while access is open, or an
 * offer to open hidden records when the API says there are some and the role may.
 */
export function PatientAccessNotice({ patientId }: { patientId: string }) {
  const { status, open } = usePatientBreakGlass(patientId);
  const [asking, setAsking] = useState(false);
  const info = status.data;
  if (!info) return null;
  if (info.grant) return <BreakGlassBanner expiresAt={info.grant.expires_at} />;
  if (!info.hidden_records) return null;
  if (!info.can_break_glass) {
    return <Banner>Some of this patient&apos;s records are outside your access.</Banner>;
  }

  const failure = open.error ? apiError(open.error) : null;
  return (
    <>
      <Banner
        title="Some of this patient's records are outside your normal access."
        action={
          <Button variant="ghost" onClick={() => setAsking(true)}>
            Open with break-glass
          </Button>
        }
      >
        In an emergency you can open them with a recorded reason.
      </Banner>
      <BreakGlassDialog
        open={asking}
        onOpenChange={(next) => {
          setAsking(next);
          if (!next) open.reset();
        }}
        onConfirm={(reason) => open.mutate(reason, { onSuccess: () => setAsking(false) })}
        busy={open.isPending}
        error={failure ? (fieldErrors(failure).reason ?? failure.message) : undefined}
      />
    </>
  );
}
