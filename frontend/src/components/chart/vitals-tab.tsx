"use client";

import { Heartbeat, Trash } from "@phosphor-icons/react";
import { useState } from "react";

import { AreaLineChart } from "@/components/charts/area-line-chart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KebabMenu } from "@/components/ui/menu";
import { RangeSelect } from "@/components/ui/select";
import { api, type Schemas, unwrap } from "@/lib/api";
import { useRefreshChart, useVitals } from "@/lib/chart-queries";
import { formatDateTime, formatDay } from "@/lib/format";
import { formatReading, LOINC, reading, TILES, tileReading, trend } from "@/lib/vitals";

import { QueryState } from "./query-state";
import { ReasonModal } from "./reason-modal";

type VitalSet = Schemas["VitalSigns"];

type Props = {
  patientId: string;
  ageYears: number;
  /** Whether a visit is open, so readings can be recorded. */
  canRecord: boolean;
  onRecord: () => void;
  hidden: ReadonlySet<string>;
  schedule: (action: { id: string; message: string; commit: () => Promise<unknown> }) => void;
};

const CHART_CHOICES = [
  { value: LOINC.systolic, label: "Systolic blood pressure" },
  { value: LOINC.diastolic, label: "Diastolic blood pressure" },
  { value: LOINC.heartRate, label: "Heart rate" },
  { value: LOINC.temperature, label: "Temperature" },
  { value: LOINC.oxygen, label: "Oxygen saturation" },
  { value: LOINC.bmi, label: "BMI" },
];

const DIGITS: Record<string, number> = { [LOINC.temperature]: 1, [LOINC.bmi]: 1 };

function cell(set: VitalSet, code: string, digits = 0): string {
  const value = reading(set, code);
  return value === undefined ? "—" : formatReading(value, digits);
}

/** Vital signs history with a trend chart and the form to record a new set. */
export function VitalsTab({ patientId, ageYears, canRecord, onRecord, hidden, schedule }: Props) {
  const vitals = useVitals(patientId);
  const refresh = useRefreshChart(patientId);
  const [metric, setMetric] = useState<string>(LOINC.systolic);
  const [correcting, setCorrecting] = useState<VitalSet | null>(null);

  const columns: Column<VitalSet>[] = [
    {
      id: "recorded",
      header: "Recorded",
      cell: (s) => <span className="whitespace-nowrap">{formatDateTime(s.recorded_at)}</span>,
    },
    ...TILES.map((spec) => ({
      id: spec.id,
      header: spec.label,
      cell: (s: VitalSet) => {
        const shown = tileReading(spec, s, ageYears);
        return (
          <span className="tnum whitespace-nowrap">
            {shown?.text ?? "—"}
            {shown && (shown.assessment === "low" || shown.assessment === "high") && (
              <span className="text-amber-text font-semibold"> ({shown.assessment})</span>
            )}
          </span>
        );
      },
    })),
    {
      id: "size",
      header: "Weight and height",
      cell: (s) => (
        <span className="tnum whitespace-nowrap">
          {cell(s, "29463-7", 1)} kg · {cell(s, "8302-2")} cm
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Vital signs"
        action={
          canRecord ? (
            <Button icon={Heartbeat} onClick={onRecord}>
              Record vitals
            </Button>
          ) : undefined
        }
      >
        <QueryState query={vitals} what="vital signs">
          {(data) => {
            const sets = data.results.filter((s) => !hidden.has(s.id));
            if (sets.length === 0) {
              return (
                <EmptyState
                  title="No vital signs recorded."
                  action={
                    canRecord ? (
                      <Button icon={Heartbeat} onClick={onRecord}>
                        Record vitals
                      </Button>
                    ) : undefined
                  }
                />
              );
            }
            const choice = CHART_CHOICES.find((c) => c.value === metric)!;
            const points = trend(sets, metric, formatDay);
            return (
              <>
                <AreaLineChart
                  label={`${choice.label} over time`}
                  data={points}
                  formatValue={(v) => formatReading(v, DIGITS[metric] ?? 0)}
                  emptyText={`No ${choice.label.toLowerCase()} readings yet.`}
                  height={200}
                  zeroBased={false}
                  rangeSelector={
                    <RangeSelect
                      label="Reading shown in the chart"
                      value={metric}
                      onValueChange={setMetric}
                      options={CHART_CHOICES}
                    />
                  }
                />
                <DataTable
                  caption="Vital signs, most recent first"
                  columns={columns}
                  rows={sets}
                  rowId={(s) => s.id}
                  empty={null}
                  actions={(s) => (
                    <KebabMenu
                      label={`Actions for the readings of ${formatDateTime(s.recorded_at)}`}
                      items={[
                        {
                          label: "Entered in error",
                          icon: Trash,
                          danger: true,
                          onSelect: () => setCorrecting(s),
                        },
                      ]}
                    />
                  )}
                />
              </>
            );
          }}
        </QueryState>
      </Card>
      <ReasonModal
        open={correcting !== null}
        onOpenChange={(open) => !open && setCorrecting(null)}
        title="Mark vital signs as entered in error"
        explanation="The readings leave the chart but stay in the record's history."
        onConfirm={(reason) => {
          const set = correcting!;
          schedule({
            id: set.id,
            message: "Vital signs hidden as entered in error.",
            commit: async () => {
              await unwrap(
                api.POST("/api/clinical/vitals/{id}/entered-in-error/", {
                  params: { path: { id: set.id } },
                  body: { reason },
                }),
              );
              await refresh();
            },
          });
        }}
      />
    </div>
  );
}
