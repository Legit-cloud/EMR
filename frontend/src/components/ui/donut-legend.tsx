import { DONUT_SERIES, percentages } from "@/lib/chart-colours";
import { cx } from "@/lib/cx";

export type LegendItem = { label: string; value: number };

/**
 * Legend for a donut chart: dot, name and percent, coloured in the Section 2.3 series order.
 * DonutChart (components/charts) pairs it with the ring in the same order.
 */
export function DonutLegend({ items, label }: { items: LegendItem[]; label: string }) {
  const shares = percentages(items.map((item) => item.value));
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={item.label} className="text-small text-ink-600 flex items-center gap-2">
          <span
            aria-hidden
            className={cx("size-2 shrink-0 rounded-full", DONUT_SERIES[i % DONUT_SERIES.length])}
          />
          <span className="flex-1 truncate">{item.label}</span>
          <span className="text-ink-900 tnum font-bold">{shares[i]}%</span>
        </li>
      ))}
    </ul>
  );
}
