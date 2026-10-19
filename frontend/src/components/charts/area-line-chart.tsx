"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_PAINT } from "@/lib/chart-colours";

import {
  AXIS_TICK,
  ChartFrame,
  ChartTooltip,
  describeSeries,
  formatNumber,
  type LinePoint,
} from "./chart-frame";

type Props = {
  /** Names the chart for screen readers and the table, for example "Cashflow". */
  label: string;
  data: LinePoint[];
  /** Formats values for the tooltip, axis, summary and table. */
  formatValue?: (value: number) => string;
  /** Shorter values for the y axis, for example "₦9k". Defaults to formatValue. */
  formatAxis?: (value: number) => string;
  /** Range selector shown top right ("Last 12 months ▾"). */
  rangeSelector?: ReactNode;
  loading?: boolean;
  emptyText?: string;
  height?: number;
};

/**
 * Blue line over a soft vertical gradient, dotted grid, and a dark tooltip with a vertical
 * hairline and a ring marker on the line (docs/DESIGN.md Sections 2.3 and 7).
 */
export function AreaLineChart({
  label,
  data,
  formatValue = formatNumber,
  formatAxis = formatValue,
  rangeSelector,
  loading,
  emptyText = "No data for this period.",
  height = 240,
}: Props) {
  // useId gives ":r1:"-style ids; colons are not valid in a url(#...) reference.
  const gradientId = `area-fill-${useId().replace(/:/g, "")}`;
  return (
    <ChartFrame
      label={label}
      summary={describeSeries(data, formatValue)}
      rows={data}
      columns={[
        { header: "Period", cell: (row) => row.label },
        { header: label, cell: (row) => formatValue(row.value) },
      ]}
      rowKey={(row) => row.label}
      loading={loading}
      empty={data.length === 0}
      emptyText={emptyText}
      height={height}
      rangeSelector={rangeSelector}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_PAINT.line} stopOpacity={0.14} />
              <stop offset="100%" stopColor={CHART_PAINT.line} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_PAINT.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} dy={6} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={formatAxis}
          />
          <Tooltip
            cursor={{ stroke: CHART_PAINT.hairline, strokeWidth: 1 }}
            content={({ active, payload, label: period }) =>
              active && payload?.length ? (
                <ChartTooltip
                  label={String(period)}
                  rows={[{ value: formatValue(Number(payload[0].value)) }]}
                />
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            name={label}
            stroke={CHART_PAINT.line}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{
              r: 5,
              fill: CHART_PAINT.marker,
              stroke: CHART_PAINT.line,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
