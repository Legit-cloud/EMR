"use client";

import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { CHART_PAINT } from "@/lib/chart-colours";
import { cx } from "@/lib/cx";

export type ChartColumn<T> = { header: string; cell: (row: T) => string };

type FrameProps<T> = {
  /** What the chart shows, for example "Cashflow". Names the figure and its table. */
  label: string;
  /** One or two sentences a screen reader hears instead of the picture. */
  summary: string;
  rows: T[];
  columns: ChartColumn<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty: boolean;
  emptyText: string;
  /** Plot height in px; the skeleton and empty state keep it so the card does not jump. */
  height: number;
  /** Legend on the left of the toolbar. */
  legend?: ReactNode;
  /** Range selector on the right of the toolbar. */
  rangeSelector?: ReactNode;
  /** Hides the "Show table" button where the legend already lists every value. */
  hideTableToggle?: boolean;
  /** Fixed plot width in px (the donut ring); otherwise the plot fills the row. */
  plotWidth?: number;
  /** Shown beside the plot and read by screen readers, for example the donut legend. */
  aside?: ReactNode;
  children: ReactNode;
};

/**
 * Shared shell for every chart: loading skeleton, empty state, a text summary and a data
 * table. The SVG is hidden from screen readers; they get the summary and the table instead,
 * and sighted users can swap the picture for the same table.
 */
export function ChartFrame<T>({
  label,
  summary,
  rows,
  columns,
  rowKey,
  loading = false,
  empty,
  emptyText,
  height,
  legend,
  rangeSelector,
  hideTableToggle = false,
  plotWidth,
  aside,
  children,
}: FrameProps<T>) {
  const captionId = useId();
  const [asTable, setAsTable] = useState(false);

  if (loading) {
    return (
      <Loading label={`Loading ${label.toLowerCase()}`}>
        <div style={{ height }}>
          <Skeleton className="rounded-control h-full w-full" />
        </div>
      </Loading>
    );
  }

  const toolbar = (legend || rangeSelector || !hideTableToggle) && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {!empty && legend}
      <div className="ml-auto flex items-center gap-2">
        {rangeSelector}
        {!empty && !hideTableToggle && (
          <Button variant="ghost" onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Show chart" : "Show table"}
          </Button>
        )}
      </div>
    </div>
  );

  if (empty) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        <div style={{ minHeight: height }} className="grid place-items-center">
          <EmptyState title={emptyText} />
        </div>
      </div>
    );
  }

  return (
    <figure aria-labelledby={captionId} className="flex min-w-0 flex-col gap-3">
      <figcaption id={captionId} className="sr-only">
        {label}. {summary}
      </figcaption>
      {toolbar}
      {!asTable && (
        <div className="flex flex-wrap items-center gap-5">
          <div
            aria-hidden
            style={{ height, width: plotWidth }}
            className={plotWidth ? "shrink-0" : "min-w-0 flex-1"}
          >
            {children}
          </div>
          {/* Wraps below the plot when there is no room for full legend names beside it. */}
          {aside && <div className="min-w-40 flex-1">{aside}</div>}
        </div>
      )}
      <div className={cx(asTable ? "max-h-80 overflow-auto" : "sr-only")}>
        <table className="text-body w-full text-left">
          <caption className="sr-only">{label}, as a table</caption>
          <thead className="bg-surface-muted text-label-caps text-ink-500 uppercase">
            <tr>
              {columns.map((column) => (
                <th key={column.header} scope="col" className="px-3 py-2">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-line border-t">
                {columns.map((column, i) => (
                  <td key={column.header} className={cx("tnum px-3 py-2", i > 0 && "text-ink-600")}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export type LinePoint = { label: string; value: number };

export type TooltipRow = { name?: string; value: string; dot?: string };

/** Dark chart tooltip from Section 2.3: ink-900, white text, radius 8, small label, bold value. */
export function ChartTooltip({ label, rows }: { label: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-cal bg-ink-900 text-surface shadow-pop flex flex-col gap-0.5 px-3 py-2">
      <span className="text-small opacity-80">{label}</span>
      {rows.map((row) => (
        <span key={row.name ?? row.value} className="text-body tnum flex items-center gap-1.5">
          {row.dot && <span aria-hidden className={cx("size-2 rounded-full", row.dot)} />}
          {row.name && <span className="font-medium opacity-80">{row.name}</span>}
          <span className="font-bold">{row.value}</span>
        </span>
      ))}
    </div>
  );
}

/** A dot legend for series charts (every series needs a legend or a direct label). */
export function SeriesLegend({ items }: { items: { label: string; dot: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="text-small text-ink-600 flex items-center gap-1.5">
          <span aria-hidden className={cx("size-2 rounded-full", item.dot)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** "12 months from Jan to Dec. Highest ₦9,000.00 in Mar; lowest ₦1,000.00 in Jul." */
export function describeSeries(
  points: LinePoint[],
  format: (value: number) => string,
  noun = "points",
): string {
  if (points.length === 0) return "No data.";
  let high = points[0];
  let low = points[0];
  for (const point of points) {
    if (point.value > high.value) high = point;
    if (point.value < low.value) low = point;
  }
  const first = points[0].label;
  const last = points[points.length - 1];
  const span = points.length === 1 ? first : `from ${first} to ${last.label}`;
  return (
    `${points.length} ${noun} ${span}. Highest ${format(high.value)} in ${high.label}; ` +
    `lowest ${format(low.value)} in ${low.label}; latest ${format(last.value)}.`
  );
}

/** Default number format; money charts pass formatMoney instead. */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-NG");
}

/** Axis tick text: ink-500 at the Small size, no tick lines or axis lines. */
export const AXIS_TICK = { fill: CHART_PAINT.axis, fontSize: 12.5 } as const;
