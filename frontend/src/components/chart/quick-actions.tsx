"use client";

import { Heartbeat, Note, Pill, Stethoscope } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

type Props = {
  canPrescribe: boolean;
  onPrescribe: () => void;
  onRecordVitals: () => void;
  onAddDiagnosis: () => void;
  onWriteNote: () => void;
};

/**
 * The floating bar of things a clinician does during a visit. Shown only while a visit is
 * open. It is a shortcut: every action is also on its own tab.
 */
export function QuickActions({
  canPrescribe,
  onPrescribe,
  onRecordVitals,
  onAddDiagnosis,
  onWriteNote,
}: Props) {
  return (
    <nav
      aria-label="Quick actions for this visit"
      className="rounded-pill border-line bg-surface shadow-pop fixed bottom-6 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto border p-1.5"
    >
      <Button variant="ghost" icon={Heartbeat} onClick={onRecordVitals}>
        Record vitals
      </Button>
      <Button variant="ghost" icon={Stethoscope} onClick={onAddDiagnosis}>
        Add diagnosis
      </Button>
      <Button variant="ghost" icon={Note} onClick={onWriteNote}>
        Write note
      </Button>
      {canPrescribe && (
        <Button variant="ghost" icon={Pill} onClick={onPrescribe}>
          Prescribe
        </Button>
      )}
    </nav>
  );
}
