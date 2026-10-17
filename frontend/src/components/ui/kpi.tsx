import { ArrowDown, ArrowUp, type Icon } from "@phosphor-icons/react";

import { cx } from "@/lib/cx";
import { type Tone, TONES } from "@/lib/status-map";

import { IconTile } from "./icon-tile";

/** Rounds to one decimal and drops a trailing ".0". */
function formatPercent(value: number): string {
  return `${Math.abs(Math.round(value * 10) / 10)}%`;
}

/**
 * Small tint pill with an arrow and a percent: green up, pink down, grey flat.
 * `goodWhen="down"` flips the colours for figures where a fall is good (expenses, no-shows).
 */
export function DeltaChip({ value, goodWhen = "up" }: { value: number; goodWhen?: "up" | "down" }) {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const tone: Tone = direction === "flat" ? "grey" : direction === goodWhen ? "green" : "pink";
  const Arrow = direction === "down" ? ArrowDown : ArrowUp;
  return (
    <span
      className={cx(
        "rounded-pill text-small tnum inline-flex h-6 items-center gap-1 px-2 font-semibold",
        TONES[tone].pill,
      )}
    >
      {direction !== "flat" && <Arrow aria-hidden size={12} weight="bold" />}
      <span className="sr-only">
        {direction === "up" ? "Up" : direction === "down" ? "Down" : "No change,"}
      </span>
      {formatPercent(value)}
    </span>
  );
}

type KpiProps = {
  label: string;
  /** Already formatted, for example "₦13,232.00" or "48". */
  value: string;
  delta?: number;
  goodWhen?: "up" | "down";
  icon?: { icon: Icon; tone?: Tone };
  /** Grey line under the value, for example "vs last month". */
  caption?: string;
};

/** Caps label, 24 px value, optional delta chip and icon tile (docs/DESIGN.md Section 7). */
export function KpiBlock({ label, value, delta, goodWhen, icon, caption }: KpiProps) {
  return (
    <div className="flex items-start gap-3">
      {icon && <IconTile icon={icon.icon} tone={icon.tone} />}
      <dl className="flex min-w-0 flex-col gap-1">
        <dt className="text-label-caps text-ink-500 uppercase">{label}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="text-kpi text-ink-900 tnum">{value}</span>
          {delta !== undefined && <DeltaChip value={delta} goodWhen={goodWhen} />}
        </dd>
        {caption && <dd className="text-small text-ink-500">{caption}</dd>}
      </dl>
    </div>
  );
}
