"use client";

import { ArrowDown, ArrowUp, WarningCircle } from "@phosphor-icons/react";

import { Sparkline } from "@/components/charts/sparkline";
import type { Schemas } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import { formatReading, setsWith, type TileSpec, TILES, tileReading, trend } from "@/lib/vitals";

type VitalSet = Schemas["VitalSigns"];

const ASSESSMENT_LABEL = { low: "Low", high: "High" } as const;

/**
 * The latest vital signs as KPI tiles: value, change since the reading before, a small trend,
 * and a flag when a value is outside the adult reference limits. The flag is an icon and a
 * word as well as a colour, so it never relies on colour alone.
 */
export function VitalTiles({ sets, ageYears }: { sets: VitalSet[]; ageYears: number }) {
  return (
    <ul
      aria-label="Latest vital signs"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5"
    >
      {TILES.map((spec) => (
        <VitalTile key={spec.id} spec={spec} sets={sets} ageYears={ageYears} />
      ))}
    </ul>
  );
}

function VitalTile({
  spec,
  sets,
  ageYears,
}: {
  spec: TileSpec;
  sets: VitalSet[];
  ageYears: number;
}) {
  const own = setsWith(spec, sets);
  const latest = tileReading(spec, own[0], ageYears);
  const before = tileReading(spec, own[1], ageYears);
  const change = latest && before ? latest.primary - before.primary : undefined;
  const flagged =
    latest?.assessment === "low" || latest?.assessment === "high" ? latest.assessment : null;
  const points = trend(own, spec.codes[0], formatDay).slice(-7);

  return (
    <li
      className="rounded-card border-line bg-surface shadow-card flex flex-col gap-2 border p-4"
      aria-label={spec.label}
    >
      <span className="text-label-caps text-ink-500 uppercase">{spec.label}</span>
      {latest ? (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className={cx("text-kpi tnum", flagged ? "text-amber-text" : "text-ink-900")}>
              {latest.text}
            </span>
            <span className="text-small text-ink-500">{spec.unit}</span>
          </p>
          <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
            {flagged && (
              <span className="text-small text-amber-text bg-amber-tint rounded-pill inline-flex items-center gap-1 px-2 py-0.5 font-semibold">
                <WarningCircle aria-hidden size={14} weight="fill" />
                {ASSESSMENT_LABEL[flagged]}
              </span>
            )}
            {change !== undefined && change !== 0 && (
              <span className="text-small text-ink-600 tnum inline-flex items-center gap-0.5">
                {change > 0 ? (
                  <ArrowUp aria-hidden size={12} />
                ) : (
                  <ArrowDown aria-hidden size={12} />
                )}
                {formatReading(Math.abs(change), spec.digits)}
                <span className="sr-only">
                  {change > 0 ? " up" : " down"} since the reading before
                </span>
              </span>
            )}
            {change === 0 && <span className="text-small text-ink-500">No change</span>}
          </div>
          <div className="flex items-end justify-between gap-2">
            <span className="text-small text-ink-500">{formatDay(own[0].recorded_at)}</span>
            {points.length > 1 && (
              <Sparkline label={`${spec.label} trend`} data={points} width={72} height={24} />
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-kpi text-ink-400" aria-hidden>
            —
          </p>
          <p className="text-small text-ink-500">Not recorded</p>
        </>
      )}
    </li>
  );
}
