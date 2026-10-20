"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Mark the diagnosis as entered in error". */
  title: string;
  explanation: string;
  onConfirm: (reason: string) => void;
};

const FORM_ID = "reason-form";

/** Asks why a record is being marked as entered in error. The API requires a reason. */
export function ReasonModal({ open, onOpenChange, title, explanation, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const [empty, setEmpty] = useState(false);

  function close(next: boolean) {
    if (!next) {
      setReason("");
      setEmpty(false);
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return setEmpty(true);
    onConfirm(reason.trim());
    close(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={title}
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID}>
              Mark as entered in error
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-body text-ink-600">{explanation}</p>
        <Textarea
          label="Reason"
          rows={3}
          maxLength={500}
          showCount
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setEmpty(false);
          }}
          error={empty ? "Give a reason." : undefined}
        />
      </form>
    </Modal>
  );
}
