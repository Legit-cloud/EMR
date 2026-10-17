import { useId } from "react";

import { percentages, type SeriesFill } from "@/lib/chart-colours";
import { cx } from "@/lib/cx";

type ProgressProps = {
  /** Screen-reader name, for example "Items received". */
  label: string;
  value: number;
  max: number;
  /** Shows "2/4" on the right. */
  showFraction?: boolean;
};

/** 6 px bar; blue while in progress, green when complete (docs/DESIGN.md Section 7). */
export function ProgressBar({ label, value, max, showFraction = true }: ProgressProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  const width = max > 0 ? (clamped / max) * 100 : 0;
  const complete = max > 0 && clamped >= max;
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} of ${max}`}
        className="bg-line rounded-pill h-1.5 min-w-16 flex-1 overflow-hidden"
      >
        <div
          className={cx(
            "rounded-pill h-full transition-[width] duration-300 ease-out motion-reduce:transition-none",
            complete ? "bg-green" : "bg-blue-600",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {showFraction && (
        <span aria-hidden className="text-small text-ink-600 tnum shrink-0">
          {clamped}/{max}
        </span>
      )}
    </div>
  );
}

export type Segment = { label: string; value: number; fill: SeriesFill };

/** 6 px bar split into coloured segments, with a dot legend and counts below. */
export function SegmentedStatBar({ label, segments }: { label: string; segments: Segment[] }) {
  const id = useId();
  const shares = percentages(segments.map((s) => s.value));
  return (
    <figure aria-labelledby={id} className="flex flex-col gap-3">
      <figcaption id={id} className="sr-only">
        {label}
      </figcaption>
      <div aria-hidden className="bg-line rounded-pill flex h-1.5 gap-0.5 overflow-hidden">
        {segments.map((segment, i) =>
          segment.value > 0 ? (
            <span
              key={segment.label}
              className={cx("h-full first:rounded-l-pill last:rounded-r-pill", segment.fill)}
              style={{ width: `${shares[i]}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((segment) => (
          <li key={segment.label} className="text-small text-ink-600 flex items-center gap-1.5">
            <span aria-hidden className={cx("size-2 rounded-full", segment.fill)} />
            {segment.label}
            <span className="text-ink-900 tnum font-bold">{segment.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
