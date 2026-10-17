import { type ReactNode, useId } from "react";

import { cx } from "@/lib/cx";

type Props = {
  title?: string;
  /** Range selector or action on the right of the header. */
  action?: ReactNode;
  /** Heading level for the title; pages start at h1, so cards default to h2. */
  as?: "h2" | "h3";
  className?: string;
  children: ReactNode;
};

/** White card, radius 14, line border, soft shadow, padding 20 (docs/DESIGN.md Section 7). */
export function Card({ title, action, as: Heading = "h2", className, children }: Props) {
  const id = useId();
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={cx(
        "rounded-card border-line bg-surface shadow-card flex min-w-0 flex-col gap-4 border p-5",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex min-h-8 items-center justify-between gap-3">
          {title && (
            <Heading id={id} className="text-card-title text-ink-900">
              {title}
            </Heading>
          )}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
