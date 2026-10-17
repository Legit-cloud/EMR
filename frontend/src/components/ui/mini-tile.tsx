import { cx } from "@/lib/cx";
import { type Tone, TONES } from "@/lib/status-map";

export type MiniTileItem = { label: string; value: string; tone?: Tone };

/** surface-muted tiles in a 2x2 grid with a dot, a label and a bold value ("Top expense"). */
export function MiniTiles({ items }: { items: MiniTileItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-control bg-surface-muted flex flex-col gap-1 p-3">
          <dt className="text-small text-ink-600 flex items-center gap-1.5">
            <span
              aria-hidden
              className={cx("size-2 shrink-0 rounded-full", TONES[item.tone ?? "blue"].dot)}
            />
            {item.label}
          </dt>
          <dd className="text-body text-ink-900 tnum font-bold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
