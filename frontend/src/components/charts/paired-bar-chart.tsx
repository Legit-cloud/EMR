"use client";

import { type ReactNode, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_PAINT, INCOME_EXPENSE_SERIES } from "@/lib/chart-colours";

import { AXIS_TICK, ChartFrame, ChartTooltip, formatNumber, SeriesLegend } from "./chart-frame";

export type PairedPoint = { label: string; income: number; expense: number };

type Props = {
  label: string;
  data: PairedPoint[];
  formatValue?: (value: number) => string;
  formatAxis?: (value: number) => string;
  rangeSelector?: ReactNode;
  loading?: boolean;
  emptyText?: string;
  height?: number;
  /** Series names, for example billed and collected. The green series comes first. */
  names?: { income: string; expense: string };
};

const DEFAULT_NAMES = { income: "Income", expense: "Expense" };

const RESTING_OPACITY = 0.45;

function summarise(
  data: PairedPoint[],
  format: (value: number) => string,
  names: { income: string; expense: string },
): string {
  const income = data.reduce((sum, d) => sum + d.income, 0);
  const expense = data.reduce((sum, d) => sum + d.expense, 0);
  const span = data.length === 1 ? data[0].label : `${data[0].label} to ${data.at(-1)!.label}`;
  return (
    `${span}. Total ${names.income.toLowerCase()} ${format(income)}; ` +
    `total ${names.expense.toLowerCase()} ${format(expense)}.`
  );
}

/**
 * Soft green income and amber expense bars side by side. Hovering a month brings its bars
 * to full strength, fades the rest, and draws a dashed reference line at its income.
 */
export function PairedBarChart({
  label,
  data,
  formatValue = formatNumber,
  formatAxis = formatValue,
  rangeSelector,
  loading,
  emptyText = "No income or expenses for this period.",
  height = 240,
  names = DEFAULT_NAMES,
}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const SERIES = [
    { key: "income", name: names.income, ...INCOME_EXPENSE_SERIES.income },
    { key: "expense", name: names.expense, ...INCOME_EXPENSE_SERIES.expense },
  ] as const;
  const hovered = active === null ? undefined : data[active];

  return (
    <ChartFrame
      label={label}
      summary={data.length ? summarise(data, formatValue, names) : "No data."}
      rows={data}
      columns={[
        { header: "Period", cell: (row) => row.label },
        { header: names.income, cell: (row) => formatValue(row.income) },
        { header: names.expense, cell: (row) => formatValue(row.expense) },
      ]}
      rowKey={(row) => row.label}
      loading={loading}
      empty={data.length === 0}
      emptyText={emptyText}
      height={height}
      legend={<SeriesLegend items={SERIES.map((s) => ({ label: s.name, dot: s.dot }))} />}
      rangeSelector={rangeSelector}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barGap={4}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={(state) => {
            const index = state.activeTooltipIndex;
            setActive(index === undefined || index === null ? null : Number(index));
          }}
          onMouseLeave={() => setActive(null)}
        >
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
            cursor={{ fill: CHART_PAINT.hoverBand, radius: 8 }}
            content={({ active: open, label: period }) => {
              const point = data.find((d) => d.label === period);
              return open && point ? (
                <ChartTooltip
                  label={point.label}
                  rows={SERIES.map((s) => ({
                    name: s.name,
                    value: formatValue(point[s.key]),
                    dot: s.dot,
                  }))}
                />
              ) : null;
            }}
          />
          {hovered && (
            <ReferenceLine y={hovered.income} stroke={CHART_PAINT.hairline} strokeDasharray="4 4" />
          )}
          {SERIES.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.paint}
              maxBarSize={12}
              radius={[6, 6, 6, 6]}
              isAnimationActive={false}
            >
              {data.map((point, i) => (
                <Cell
                  key={point.label}
                  fillOpacity={active === null || active === i ? 1 : RESTING_OPACITY}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
