/**
 * Series fills from docs/DESIGN.md Section 2.3, as Tailwind classes. Fills and dots only:
 * series colours are never used for text. The chart components in F4 use the same order.
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

/** Stock bar: available, low, out. */
export const STOCK_SERIES = {
  available: "bg-teal",
  low: "bg-chart-expense",
  out: "bg-chart-out",
} as const;

export type SeriesFill =
  (typeof DONUT_SERIES)[number] | (typeof STOCK_SERIES)[keyof typeof STOCK_SERIES];

/** Whole percentages for a legend. An empty total gives zeros rather than NaN. */
export function percentages(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  return values.map((v) => (total > 0 ? Math.round((v / total) * 100) : 0));
}
