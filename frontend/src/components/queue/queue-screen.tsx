"use client";

import { CheckCircle, Clock, WifiSlash } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  APPOINTMENT_TYPES,
  conflictMessage,
  useChangeStatus,
  usePhysicians,
} from "@/lib/appointments";
import { cx } from "@/lib/cx";
import { formatTime, humanise } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { type Connection, type QueueEntry, useLiveQueue } from "@/lib/queue";
import { useMe } from "@/lib/session";
import { TONES, TRIAGE_LEVEL } from "@/lib/status-map";
import {
  formatWait,
  triageLevel,
  WAIT_THRESHOLDS,
  type WaitThresholds,
  waitMinutes,
  waitTone,
} from "@/lib/triage";

const serviceLabel = (type: string) =>
  APPOINTMENT_TYPES.find((t) => t.value === type)?.label ?? humanise(type);

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  refused: "Live updates not allowed",
};

/** Re-renders now and then, so waiting times move without new data. */
function useClock(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** The physician's waiting queue (docs/DESIGN.md 7): live, most urgent first, then by arrival. */
export function QueueScreen({ thresholds = WAIT_THRESHOLDS }: { thresholds?: WaitThresholds }) {
  const me = useMe();
  const physicians = usePhysicians();
  const [chosen, setChosen] = useState<string | null>(null);

  if (physicians.error instanceof ApiRequestError && physicians.error.status === 403) {
    return <NoAccess what="the waiting queue" asPage />;
  }
  if (!physicians.data) {
    return (
      <Loading label="Loading the queue">
        <Skeleton className="rounded-card h-72 w-full" />
      </Loading>
    );
  }

  const list = physicians.data;
  // A doctor sees their own queue first; anyone else starts with the first physician.
  const physician = chosen ?? list.find((p) => p.user === me.id)?.user ?? list[0]?.user ?? "";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-page-title text-ink-900">Waiting queue</h1>
        {list.length > 0 && (
          <Select
            label="Physician"
            hideLabel
            value={physician}
            onValueChange={setChosen}
            options={list.map((p) => ({ value: p.user, label: p.display_name }))}
            className="ml-auto w-56"
          />
        )}
      </header>
      {physician === "" ? (
        <EmptyState title="There are no physicians to show a queue for." />
      ) : (
        <PhysicianQueue key={physician} physician={physician} thresholds={thresholds} />
      )}
    </div>
  );
}

function PhysicianQueue({
  physician,
  thresholds,
}: {
  physician: string;
  thresholds: WaitThresholds;
}) {
  const { rows, fresh, announcement, connection, loadFailed, retry } = useLiveQueue(physician);
  const now = useClock();
  const toast = useToast();
  const router = useRouter();
  const permissions = usePermissions();
  const start = useChangeStatus();
  const [starting, setStarting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const canStart = permissions.hasRole("doctor", "nurse");

  async function startConsultation(entry: QueueEntry) {
    setProblem(null);
    setStarting(entry.appointment_id);
    try {
      await start.mutateAsync({ id: entry.appointment_id, status: "in_consultation" });
    } catch (failure) {
      setStarting(null);
      return setProblem(conflictMessage(failure));
    }
    setStarting(null);
    toast({
      title: "Consultation started",
      description: entry.patient_name,
      tone: "success",
      action: {
        label: "Open chart",
        onClick: () => router.push(`/patients/${entry.patient_id}`),
      },
    });
  }

  const columns: Column<QueueEntry>[] = [
    {
      id: "position",
      header: "#",
      className: "w-12",
      cell: (entry) => (
        <span className="tnum text-ink-600 font-semibold">{(rows?.indexOf(entry) ?? 0) + 1}</span>
      ),
    },
    {
      id: "patient",
      header: "Patient",
      cell: (entry) => (
        <Link
          href={`/patients/${entry.patient_id}`}
          className="text-body text-ink-900 font-semibold hover:underline"
        >
          {entry.patient_name}
          <span className="text-small text-ink-500 block font-mono font-normal">{entry.mrn}</span>
        </Link>
      ),
    },
    {
      id: "priority",
      header: "Priority",
      cell: (entry) => {
        const level = triageLevel(entry.triage_priority);
        return level ? (
          <StatusPill status={TRIAGE_LEVEL[level]} />
        ) : (
          <span className="text-small text-ink-500">Not triaged</span>
        );
      },
    },
    {
      id: "waiting",
      header: "Waiting",
      cell: (entry) => <WaitChip entry={entry} now={now} thresholds={thresholds} />,
    },
    {
      id: "reason",
      header: "Reason",
      cell: (entry) => (
        <span className="flex flex-col">
          <span className="text-ink-900">
            {entry.reason || serviceLabel(entry.appointment_type)}
          </span>
          <span className="text-small text-ink-500">
            {serviceLabel(entry.appointment_type)}, arrived {formatTime(entry.checked_in_at)}
          </span>
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      className: "text-right",
      cell: (entry) =>
        canStart ? (
          <Button
            variant="outline"
            loading={starting === entry.appointment_id}
            disabled={starting !== null}
            onClick={() => startConsultation(entry)}
            aria-label={`Start consultation for ${entry.patient_name}`}
          >
            Start consultation
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ConnectionChip connection={connection} />
        <p className="text-small text-ink-600">
          {rows === null ? "" : `${rows.length} waiting. Most urgent first, then by arrival.`}
        </p>
      </div>

      {connection === "reconnecting" && (
        <Banner tone="danger" live title="Reconnecting">
          The queue may be out of date. It updates again when the connection is back.
        </Banner>
      )}
      {connection === "refused" && (
        <Banner tone="info" live title="Live updates are not allowed for this queue">
          The list is refreshed when you reload the page.
        </Banner>
      )}
      {problem && <Banner tone="danger" live title={problem} />}

      <p className="sr-only" aria-live="polite" data-testid="queue-announcement">
        {announcement}
      </p>

      <div className="rounded-card border-line bg-surface shadow-card overflow-hidden border">
        <DataTable
          caption="Patients waiting, in order"
          columns={columns}
          rows={rows ?? undefined}
          rowId={(entry) => entry.appointment_id}
          error={loadFailed}
          onRetry={retry}
          rowClassName={(entry) =>
            fresh.includes(entry.appointment_id)
              ? "animate-arrive motion-reduce:animate-none"
              : undefined
          }
          empty={<EmptyState title="Nobody is waiting." />}
        />
      </div>
    </>
  );
}

function ConnectionChip({ connection }: { connection: Connection }) {
  const live = connection === "live";
  const tone = live ? TONES.green : connection === "refused" ? TONES.grey : TONES.amber;
  const Glyph = live ? CheckCircle : connection === "connecting" ? Clock : WifiSlash;
  return (
    <span
      data-testid="connection"
      className={cx(
        "text-pill rounded-tag inline-flex h-6 items-center gap-1.5 px-2 whitespace-nowrap uppercase",
        tone.pill,
      )}
    >
      <Glyph aria-hidden size={14} weight="fill" />
      {CONNECTION_LABEL[connection]}
    </span>
  );
}

/** Time waiting: grey, then amber and pink past the thresholds; the words say it too. */
function WaitChip({
  entry,
  now,
  thresholds,
}: {
  entry: QueueEntry;
  now: number;
  thresholds: WaitThresholds;
}) {
  const minutes = waitMinutes(entry.checked_in_at, now);
  const level = waitTone(minutes, thresholds);
  const tone = { normal: TONES.grey, long: TONES.amber, very_long: TONES.pink }[level];
  return (
    <span
      data-wait={level}
      className={cx(
        "text-pill rounded-tag tnum inline-flex h-6 items-center gap-1.5 px-2 whitespace-nowrap",
        tone.pill,
      )}
    >
      <Clock aria-hidden size={14} />
      {formatWait(minutes)}
      {level !== "normal" && (
        <span className="sr-only">{level === "long" ? ", long wait" : ", very long wait"}</span>
      )}
    </span>
  );
}
