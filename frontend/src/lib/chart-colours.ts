/**
 * Series colours from docs/DESIGN.md Section 2.3. Fills and dots only: series colours are
 * never used for text. The *_SERIES lists are Tailwind classes for HTML (legends, bars);
 * the *_PAINT values are the same tokens as SVG paint for the Recharts charts.
 */

/** Donut segments, in order: purple, lime, sky, pink, orange, amber. */
export const DONUT_SERIES = [
  "bg-purple",
  "bg-chart-lime",
  "bg-chart-sky",
  "bg-pink",
  "bg-chart-orange",
  "bg-chart-expense",
] as const;

/** DONUT_SERIES as SVG paint; entry i is the same token as DONUT_SERIES[i]. */
export const DONUT_PAINT = [
  "var(--purple)",
  "var(--chart-lime)",
  "var(--chart-sky)",
  "var(--pink)",
  "var(--chart-orange)",
  "var(--chart-expense)",
] as const;

/** Stock bar: available, low, out. */
export const STOCK_SERIES = {
  available: "bg-teal",
  low: "bg-chart-expense",
  out: "bg-chart-out",
} as const;

/** Income and expense bars: legend dots and SVG paint. */
export const INCOME_EXPENSE_SERIES = {
  income: { dot: "bg-chart-income", paint: "var(--chart-income)" },
  expense: { dot: "bg-chart-expense", paint: "var(--chart-expense)" },
} as const;

/** Everything else a chart paints: the cashflow line, grid, axis text and hover marks. */
export const CHART_PAINT = {
  line: "var(--blue-600)",
  grid: "var(--chart-grid)",
  axis: "var(--ink-500)",
  hairline: "var(--ink-400)",
  marker: "var(--surface)",
  hoverBand: "var(--blue-50)",
} as const;

/** Invoice counts by payment status: the same colours as the Paid, Partly paid and Unpaid pills. */
export const PAYMENT_SERIES = {
  paid: "bg-green",
  partial: "bg-amber",
  unpaid: "bg-pink",
} as const;

export type SeriesFill =
  | (typeof DONUT_SERIES)[number]
  | (typeof STOCK_SERIES)[keyof typeof STOCK_SERIES]
  | (typeof PAYMENT_SERIES)[keyof typeof PAYMENT_SERIES];

/** Whole percentages for a legend. An empty total gives zeros rather than NaN. */
export function percentages(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  return values.map((v) => (total > 0 ? Math.round((v / total) * 100) : 0));
}
