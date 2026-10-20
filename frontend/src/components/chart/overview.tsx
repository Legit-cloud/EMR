"use client";

import { Pill } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { useDiagnoses, useEncounters, usePrescriptions, useVitals } from "@/lib/chart-queries";
import { cx } from "@/lib/cx";
import { formatDateTime, humanise } from "@/lib/format";
import { CLINICAL_STATUS, ENCOUNTER_STATUS, VERIFICATION_STATUS } from "@/lib/status-map";

import { AllergyCard } from "./allergy-card";
import { isCurrentProblem } from "./diagnoses-tab";
import { QueryState } from "./query-state";
import { VisitCard } from "./visit-card";
import { VitalTiles } from "./vital-tiles";

type Schedule = (action: { id: string; message: string; commit: () => Promise<unknown> }) => void;

type Props = {
  patientId: string;
  ageYears: number;
  hidden: ReadonlySet<string>;
  schedule: Schedule;
  /** The viewer's role may work on visits and allergies; the API enforces who really may. */
  canWork: boolean;
  onOpenTab: (tab: string) => void;
};

const MAX_TIMELINE = 8;
const MAX_LIST = 6;

/** The chart's first tab: the visit, the latest vital signs, the timeline, and the problem,
 * medication and allergy cards. */
export function Overview({ patientId, ageYears, hidden, schedule, canWork, onOpenTab }: Props) {
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
        <VisitCard patientId={patientId} canStart={canWork} />
        <LatestVitals
          patientId={patientId}
          ageYears={ageYears}
          hidden={hidden}
          onOpenVitals={() => onOpenTab("vitals")}
        />
        <Timeline patientId={patientId} />
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
        <ActiveProblems
          patientId={patientId}
          hidden={hidden}
          onOpenAll={() => onOpenTab("diagnoses")}
        />
        <CurrentMedications patientId={patientId} onOpenAll={() => onOpenTab("prescriptions")} />
        <AllergyCard patientId={patientId} hidden={hidden} schedule={schedule} canAdd={canWork} />
      </div>
    </div>
  );
}

function LatestVitals({
  patientId,
  ageYears,
  hidden,
  onOpenVitals,
}: {
  patientId: string;
  ageYears: number;
  hidden: ReadonlySet<string>;
  onOpenVitals: () => void;
}) {
  const vitals = useVitals(patientId);
  return (
    <section aria-labelledby="latest-vitals" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="latest-vitals" className="text-card-title text-ink-900">
          Latest vital signs
        </h2>
        <Button variant="ghost" onClick={onOpenVitals}>
          History and trends
        </Button>
      </div>
      <QueryState query={vitals} what="vital signs" rows={2}>
        {(data) => (
          <VitalTiles sets={data.results.filter((s) => !hidden.has(s.id))} ageYears={ageYears} />
        )}
      </QueryState>
      {ageYears < 18 && (
        <p className="text-small text-ink-500">
          Values are not flagged for patients under 18: reference ranges change with age.
        </p>
      )}
    </section>
  );
}

function Timeline({ patientId }: { patientId: string }) {
  const encounters = useEncounters(patientId);
  return (
    <Card title="Visits" as="h3">
      <QueryState query={encounters} what="visits">
        {(data) => {
          const rows = [...data.results]
            .sort((a, b) => Date.parse(b.started_at ?? "") - Date.parse(a.started_at ?? ""))
            .slice(0, MAX_TIMELINE);
          if (rows.length === 0) {
            return <p className="text-small text-ink-600">No visits yet.</p>;
          }
          return (
            <ol className="flex flex-col">
              {rows.map((visit, i) => (
                <li key={visit.id} className="flex gap-3">
                  <span aria-hidden className="flex flex-col items-center">
                    <span
                      className={cx(
                        "mt-1.5 size-2.5 shrink-0 rounded-full",
                        visit.status === "in_progress" ? "bg-purple" : "bg-ink-300",
                      )}
                    />
                    {i < rows.length - 1 && <span className="bg-line w-px flex-1" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-4">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-body text-ink-900 font-semibold">
                        {humanise(visit.encounter_class)} visit
                      </span>
                      <StatusPill status={ENCOUNTER_STATUS[visit.status]} />
                    </p>
                    <p className="text-small text-ink-600 tnum">
                      {formatDateTime(visit.started_at)}
                      {visit.reason ? ` · ${visit.reason}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          );
        }}
      </QueryState>
    </Card>
  );
}

function ActiveProblems({
  patientId,
  hidden,
  onOpenAll,
}: {
  patientId: string;
  hidden: ReadonlySet<string>;
  onOpenAll: () => void;
}) {
  const diagnoses = useDiagnoses(patientId);
  return (
    <Card
      title="Active problems"
      as="h3"
      action={
        <Button variant="ghost" onClick={onOpenAll}>
          View all
        </Button>
      }
    >
      <QueryState query={diagnoses} what="diagnoses" rows={2}>
        {(data) => {
          const rows = data.results.filter((d) => !hidden.has(d.id) && isCurrentProblem(d));
          if (rows.length === 0)
            return <p className="text-small text-ink-600">No current diagnoses.</p>;
          return (
            <ul className="flex flex-col">
              {rows.slice(0, MAX_LIST).map((d) => (
                <li
                  key={d.id}
                  className="border-line flex flex-col gap-1 border-t py-2.5 first:border-t-0"
                >
                  <span className="text-body text-ink-900 font-semibold">{d.display}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-small text-ink-500 font-mono">{d.code}</span>
                    <StatusPill status={CLINICAL_STATUS[d.clinical_status ?? "active"]} />
                    <StatusPill
                      status={VERIFICATION_STATUS[d.verification_status ?? "unconfirmed"]}
                    />
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </Card>
  );
}

const CURRENT_STATUSES = new Set(["authorised", "partially_dispensed", "dispensed"]);

function CurrentMedications({
  patientId,
  onOpenAll,
}: {
  patientId: string;
  onOpenAll: () => void;
}) {
  const prescriptions = usePrescriptions(patientId);
  return (
    <Card
      title="Current medications"
      as="h3"
      action={
        <Button variant="ghost" onClick={onOpenAll}>
          View all
        </Button>
      }
    >
      <QueryState query={prescriptions} what="prescriptions" rows={2}>
        {(data) => {
          const items = data.results
            .filter((p) => CURRENT_STATUSES.has(p.status))
            .flatMap((p) => p.items.map((item) => ({ ...item, prescribed: p.authorised_at })));
          if (items.length === 0) {
            return <p className="text-small text-ink-600">No medicines prescribed.</p>;
          }
          return (
            <ul className="flex flex-col">
              {items.slice(0, MAX_LIST).map((item) => (
                <li
                  key={item.id}
                  className="border-line flex items-start gap-2.5 border-t py-2.5 first:border-t-0"
                >
                  <Pill
                    aria-hidden
                    size={18}
                    weight="duotone"
                    className="text-purple mt-0.5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body text-ink-900 font-semibold">{item.drug_name}</span>
                    <span className="text-small text-ink-600">
                      {item.dose}, {item.frequency}, {item.duration_days} days
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </Card>
  );
}
