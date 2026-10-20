"use client";

import { Heartbeat, Note, Pill, Stethoscope } from "@phosphor-icons/react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { cx } from "@/lib/cx";

type Props = {
  /** The open visit; the actions only apply while one is open. */
  encounterId: string;
  canPrescribe: boolean;
  onRecordVitals: () => void;
  onAddDiagnosis: () => void;
  onWriteNote: () => void;
};

/**
 * The floating bar of things a clinician does during a visit. Shown only while a visit is
 * open. It is a shortcut: every action is also on its own tab.
 */
export function QuickActions({
  encounterId,
  canPrescribe,
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
        <Link
          href={`/prescriptions/new?encounter=${encounterId}`}
          className={cx(
            "rounded-control text-body inline-flex h-8 shrink-0 items-center gap-1 px-1 font-semibold whitespace-nowrap text-blue-600 hover:underline",
            FOCUS_RING,
          )}
        >
          <Pill aria-hidden size={16} />
          Prescribe
        </Link>
      )}
    </nav>
  );
}
