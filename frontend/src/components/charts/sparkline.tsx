"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { CHART_PAINT } from "@/lib/chart-colours";

import { describeSeries, formatNumber, type LinePoint } from "./chart-frame";

type Props = {
  /** What the trend is, for example "Heart rate, last 7 readings". */
  label: string;
  data: LinePoint[];
  formatValue?: (value: number) => string;
  loading?: boolean;
  width?: number;
  height?: number;
};

/**
 * A tiny trend line for KPI tiles and table cells: no axes, grid or tooltip. Too small for
 * a table, so screen readers get the same summary the larger charts give.
 */
export function Sparkline({
  label,
  data,
  formatValue = formatNumber,
  loading = false,
  width = 96,
  height = 32,
}: Props) {
  if (loading) {
    return (
      <span
        role="status"
        aria-label={`Loading ${label.toLowerCase()}`}
        className="inline-block"
        style={{ width, height }}
      >
        <Skeleton className="h-full w-full" />
      </span>
    );
  }
  if (data.length < 2) {
    return (
      <span className="text-small text-ink-500 inline-block" style={{ width }}>
        {data.length === 0 ? "No data" : formatValue(data[0].value)}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={`${label}. ${describeSeries(data, formatValue, "readings")}`}
      className="inline-block shrink-0"
      style={{ width, height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          {/* Scale to the readings, not from zero, so a small change still shows. */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_PAINT.line}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}
