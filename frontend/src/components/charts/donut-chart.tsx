"use client";

import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { DonutLegend } from "@/components/ui/donut-legend";
import { DONUT_PAINT, DONUT_SERIES, percentages } from "@/lib/chart-colours";

import { ChartFrame, ChartTooltip, formatNumber } from "./chart-frame";

export type DonutSlice = { label: string; value: number };

type Props = {
  label: string;
  data: DonutSlice[];
  /** Caption above the centre total, for example "Total". */
  totalLabel?: string;
  formatValue?: (value: number) => string;
  rangeSelector?: ReactNode;
  loading?: boolean;
  emptyText?: string;
  /** Ring diameter in px. */
  size?: number;
};

const RING = 14;

/**
 * 14 px ring with rounded caps and the total in the centre, legend on the right with dot,
 * name and percent. Segment colours follow the Section 2.3 order, then repeat.
 */
export function DonutChart({
  label,
  data,
  totalLabel = "Total",
  formatValue = formatNumber,
  rangeSelector,
  loading,
  emptyText = "Nothing to show for this period.",
  size = 168,
}: Props) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const shares = percentages(data.map((slice) => slice.value));
  const share = new Map(data.map((slice, i) => [slice.label, shares[i]]));

  return (
    <ChartFrame
      label={label}
      summary={
        `${totalLabel} ${formatValue(total)}. ` +
        data.map((slice, i) => `${slice.label} ${shares[i]}%`).join(", ") +
        "."
      }
      rows={data}
      columns={[
        { header: "Category", cell: (row) => row.label },
        { header: "Amount", cell: (row) => formatValue(row.value) },
        { header: "Share", cell: (row) => `${share.get(row.label)}%` },
      ]}
      rowKey={(row) => row.label}
      loading={loading}
      empty={total <= 0}
      emptyText={emptyText}
      height={size}
      rangeSelector={rangeSelector}
      hideTableToggle
      plotWidth={size}
      aside={<DonutLegend label={`${label} legend`} items={data} />}
    >
      <div className="relative h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={size / 2 - RING}
              outerRadius={size / 2}
              cornerRadius={RING / 2}
              paddingAngle={3}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((slice, i) => (
                <Cell key={slice.label} fill={DONUT_PAINT[i % DONUT_PAINT.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const slice = payload?.[0];
                if (!active || !slice) return null;
                const name = String(slice.name);
                const index = data.findIndex((d) => d.label === name);
                return (
                  <ChartTooltip
                    label={name}
                    rows={[
                      {
                        value: `${formatValue(Number(slice.value))} · ${share.get(name)}%`,
                        dot: DONUT_SERIES[index % DONUT_SERIES.length],
                      },
                    ]}
                  />
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-small text-ink-500">{totalLabel}</span>
          <span className="text-kpi-sm text-ink-900 tnum">{formatValue(total)}</span>
        </div>
      </div>
    </ChartFrame>
  );
}
