"use client";

import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KebabMenu } from "@/components/ui/menu";
import { StatusPill } from "@/components/ui/status-pill";
import { api, type Schemas, unwrap } from "@/lib/api";
import { useDiagnoses, useRefreshChart } from "@/lib/chart-queries";
import { formatDate } from "@/lib/format";
import { CLINICAL_STATUS, VERIFICATION_STATUS } from "@/lib/status-map";

import { DiagnosisStatusModal } from "./diagnosis-modals";
import { QueryState } from "./query-state";
import { ReasonModal } from "./reason-modal";

type Diagnosis = Schemas["Diagnosis"];

const CURRENT = new Set(["active", "recurrence"]);

/** Part of the problem list: current, not refuted. */
export function isCurrentProblem(d: Diagnosis): boolean {
  return CURRENT.has(d.clinical_status ?? "active") && d.verification_status !== "refuted";
}

type Props = {
  patientId: string;
  canAdd: boolean;
  onAdd: () => void;
  hidden: ReadonlySet<string>;
  schedule: (action: { id: string; message: string; commit: () => Promise<unknown> }) => void;
};

/** The problem list, with past and refuted diagnoses below it. */
export function DiagnosesTab({ patientId, canAdd, onAdd, hidden, schedule }: Props) {
  const diagnoses = useDiagnoses(patientId);
  const refresh = useRefreshChart(patientId);
  const [updating, setUpdating] = useState<Diagnosis | null>(null);
  const [correcting, setCorrecting] = useState<Diagnosis | null>(null);

  const columns: Column<Diagnosis>[] = [
    {
      id: "code",
      header: "Code",
      cell: (d) => <span className="font-mono text-small">{d.code}</span>,
    },
    {
      id: "diagnosis",
      header: "Diagnosis",
      cell: (d) => <span className="text-ink-900 font-semibold">{d.display}</span>,
    },
    {
      id: "clinical",
      header: "Clinical status",
      cell: (d) => <StatusPill status={CLINICAL_STATUS[d.clinical_status ?? "active"]} />,
    },
    {
      id: "verification",
      header: "Verification",
      cell: (d) => (
        <StatusPill status={VERIFICATION_STATUS[d.verification_status ?? "unconfirmed"]} />
      ),
    },
    {
      id: "dates",
      header: "Onset and resolved",
      cell: (d) => (
        <span className="text-ink-600 tnum whitespace-nowrap">
          {d.onset_date ? formatDate(d.onset_date) : "—"}
          {d.abatement_date ? ` → ${formatDate(d.abatement_date)}` : ""}
        </span>
      ),
    },
  ];

  const actions = (d: Diagnosis) => (
    <KebabMenu
      label={`Actions for ${d.display ?? d.code}`}
      items={[
        { label: "Update status", icon: PencilSimple, onSelect: () => setUpdating(d) },
        { label: "Entered in error", icon: Trash, danger: true, onSelect: () => setCorrecting(d) },
      ]}
    />
  );

  return (
    <Card
      title="Problem list"
      action={
        canAdd ? (
          <Button icon={Plus} onClick={onAdd}>
            Add diagnosis
          </Button>
        ) : undefined
      }
    >
      <QueryState query={diagnoses} what="diagnoses">
        {(data) => {
          const all = data.results.filter((d) => !hidden.has(d.id));
          const current = all.filter(isCurrentProblem);
          const past = all.filter((d) => !isCurrentProblem(d));
          return (
            <div className="flex flex-col gap-4">
              <DataTable
                caption="Current diagnoses"
                columns={columns}
                rows={current}
                rowId={(d) => d.id}
                actions={actions}
                empty={
                  <EmptyState
                    title="No current diagnoses."
                    action={
                      canAdd ? (
                        <Button icon={Plus} onClick={onAdd}>
                          Add diagnosis
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
              {past.length > 0 && (
                <details className="group">
                  <summary
                    className="text-body text-ink-600 cursor-pointer font-semibold"
                    data-testid="past-diagnoses"
                  >
                    Past and refuted ({past.length})
                  </summary>
                  <div className="pt-3">
                    <DataTable
                      caption="Past and refuted diagnoses"
                      columns={columns}
                      rows={past}
                      rowId={(d) => d.id}
                      actions={actions}
                      empty={null}
                    />
                  </div>
                </details>
              )}
            </div>
          );
        }}
      </QueryState>

      <DiagnosisStatusModal
        diagnosis={updating}
        onOpenChange={(open) => !open && setUpdating(null)}
        patientId={patientId}
      />
      <ReasonModal
        open={correcting !== null}
        onOpenChange={(open) => !open && setCorrecting(null)}
        title="Mark diagnosis as entered in error"
        explanation="The diagnosis leaves the chart but stays in the record's history."
        onConfirm={(reason) => {
          const diagnosis = correcting!;
          schedule({
            id: diagnosis.id,
            message: `${diagnosis.display ?? diagnosis.code} hidden as entered in error.`,
            commit: async () => {
              await unwrap(
                api.POST("/api/clinical/diagnoses/{id}/entered-in-error/", {
                  params: { path: { id: diagnosis.id } },
                  body: { reason },
                }),
              );
              await refresh();
            },
          });
        }}
      />
    </Card>
  );
}
