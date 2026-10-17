import { cx } from "@/lib/cx";
import { type StatusSpec, TONES } from "@/lib/status-map";

/**
 * Uppercase tint pill with a leading dot (docs/DESIGN.md Section 2.4). Pass a spec from
 * src/lib/status-map.ts; the label carries the meaning, so colour is never alone.
 */
export function StatusPill({ status, className }: { status: StatusSpec; className?: string }) {
  const tone = TONES[status.tone];
  return (
    <span
      className={cx(
        "text-pill rounded-tag inline-flex h-6 items-center gap-1.5 px-2 whitespace-nowrap uppercase",
        tone.pill,
        className,
      )}
    >
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {status.label}
    </span>
  );
}
