"use client";

import { ClipboardText, Flask, Pill } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconTile } from "@/components/ui/icon-tile";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { api, type Schemas, unwrap } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDate, formatTime, humanise } from "@/lib/format";
import type { Tone } from "@/lib/status-map";
import { TONES } from "@/lib/status-map";

const LINK = cx("text-small rounded-tag font-semibold text-blue-600 hover:underline", FOCUS_RING);

/** Waiting longer than these turns the chip amber, then pink (DESIGN.md Section 8, Queue). */
export const WAIT_AMBER_MINUTES = 30;
export const WAIT_PINK_MINUTES = 60;

/** "45 min", or "5 h 37 min" from an hour on. */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

export function waitTone(minutes: number): Tone {
  if (minutes >= WAIT_PINK_MINUTES) return "pink";
  if (minutes >= WAIT_AMBER_MINUTES) return "amber";
  return "grey";
}

/** Re-renders every minute so waiting times stay current. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** The physician's own queue: checked-in patients waiting, as on the Queue screen. */
export function WaitingQueueCard({ physicianId }: { physicianId: string }) {
  const now = useMinuteClock();
  const queue = useQuery({
    queryKey: ["queue", physicianId],
    queryFn: () =>
      unwrap(
        api.GET("/api/scheduling/appointments/queue/", {
          params: { query: { physician: physicianId } },
        }),
      ),
    refetchInterval: 60_000,
  });

  return (
    <Card
      title="Waiting for you"
      className="lg:col-span-8"
      action={
        <Link href="/queue" className={LINK}>
          Open queue
        </Link>
      }
    >
      {queue.isPending ? (
        <Loading label="Loading your queue">
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        </Loading>
      ) : queue.isError ? (
        <p className="text-small text-ink-600">Your queue could not be loaded.</p>
      ) : queue.data.length === 0 ? (
        <EmptyState title="Nobody is waiting for you." />
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="text-body w-full text-left">
            <caption className="sr-only">Patients waiting for you, in queue order</caption>
            <thead className="bg-surface-muted text-label-caps text-ink-500 uppercase">
              <tr>
                <th scope="col" className="px-5 py-2.5">
                  Patient
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Visit
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Priority
                </th>
                <th scope="col" className="px-5 py-2.5">
                  Waiting
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map((entry) => (
                <QueueRow key={entry.appointment_id} entry={entry} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function QueueRow({ entry, now }: { entry: Schemas["QueueEntry"]; now: number }) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(entry.checked_in_at)) / 60_000));
  const tone = TONES[waitTone(minutes)];
  return (
    <tr className="border-line hover:bg-surface-muted border-t">
      <td className="px-5 py-2.5">
        <Link href={`/patients/${entry.patient_id}`} className={cx("font-semibold", LINK)}>
          {entry.patient_name}
        </Link>
        <span className="text-small text-ink-500 block font-mono">{entry.mrn}</span>
      </td>
      <td className="text-ink-600 px-3 py-2.5">
        {humanise(entry.appointment_type)}
        <span className="text-small text-ink-500 block">booked {formatTime(entry.start_at)}</span>
      </td>
      {/* Triage priority is shown as its number until the 1-5 to colour mapping is agreed. */}
      <td className="text-ink-900 tnum px-3 py-2.5">{entry.triage_priority ?? "—"}</td>
      <td className="px-5 py-2.5">
        <span className={cx("text-small rounded-pill tnum px-2.5 py-1 font-semibold", tone.pill)}>
          {formatWait(minutes)}
        </span>
      </td>
    </tr>
  );
}

/** The clinician's unfinished work, and a licence reminder when one is due. */
export function MyTasksCard({ myDay, className }: { myDay: Schemas["MyDay"]; className?: string }) {
  const tasks = [
    {
      icon: ClipboardText,
      tone: "blue" as const,
      label: "Consultation notes to close",
      count: myDay.open_notes,
    },
    {
      icon: Pill,
      tone: "purple" as const,
      label: "Prescriptions to sign",
      count: myDay.draft_prescriptions,
    },
    // Only a doctor reviews results; the figure is null for other roles.
    ...(myDay.results_to_review === null
      ? []
      : [
          {
            icon: Flask,
            tone: "teal" as const,
            label: "Results to review",
            count: myDay.results_to_review,
          },
        ]),
  ];
  return (
    <Card title="Your tasks" className={className}>
      {myDay.licence_expires_on && (
        <Banner tone="danger" title="Your practising licence expires soon">
          It expires on {formatDate(myDay.licence_expires_on)}. Renew it and send the new licence to
          HR.
        </Banner>
      )}
      <ul className="flex flex-col gap-3">
        {tasks.map((task) => (
          <li key={task.label} className="flex items-center gap-3">
            <IconTile icon={task.icon} tone={task.tone} size={36} />
            <span className="text-body text-ink-900 flex-1">{task.label}</span>
            <span className="text-kpi-sm text-ink-900 tnum">{task.count}</span>
          </li>
        ))}
      </ul>
      {tasks.every((t) => t.count === 0) && !myDay.licence_expires_on && (
        <p className="text-small text-ink-600">Nothing outstanding.</p>
      )}
    </Card>
  );
}
