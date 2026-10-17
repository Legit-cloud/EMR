import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/** A grey placeholder block with a faint pulse. Size it with className (h-4 w-32 and so on). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "rounded-tag bg-skeleton animate-skeleton block motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/**
 * Wraps skeleton blocks for a loading region: screen readers hear "Loading …" once and skip
 * the blocks. Pages use skeletons, never spinners (docs/DESIGN.md Section 7).
 */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
