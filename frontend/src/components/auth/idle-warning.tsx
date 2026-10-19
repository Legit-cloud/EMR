"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";

/** "1:45" */
function formatLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type Props = {
  /** When the session will be signed out, in epoch ms. */
  deadline: number;
  onStay: () => void;
  onSignOut: () => void;
};

/**
 * Shown shortly before the inactivity sign-out, with a countdown. Mount it only while the
 * warning is due, so the countdown starts from the current time.
 */
export function IdleWarning({ deadline, onStay, onSignOut }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Modal
      open
      // Closing with Escape or the X counts as "I'm still here".
      onOpenChange={(next) => !next && onStay()}
      title="Are you still there?"
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onSignOut}>
              Sign out now
            </Button>
          }
          end={<Button onClick={onStay}>Stay signed in</Button>}
        />
      }
    >
      <p className="text-body text-ink-600">
        For patient privacy you will be signed out in{" "}
        <strong className="text-ink-900 tnum" aria-hidden>
          {formatLeft(deadline - now)}
        </strong>
        <span className="sr-only">about {Math.ceil((deadline - now) / 60_000)} minutes</span> unless
        you choose to stay. Unsaved changes on this page may be lost.
      </p>
    </Modal>
  );
}
