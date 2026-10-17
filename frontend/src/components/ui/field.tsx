import { WarningCircle } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";

import { cx } from "@/lib/cx";

/** Shared border, hover, focus and error styles for inputs, textareas and select triggers. */
export const CONTROL =
  "rounded-control border-line bg-surface text-body text-ink-900 placeholder:text-ink-400 w-full border transition-shadow duration-150 ease-out hover:border-ink-300 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 focus-visible:shadow-[inset_0_0_0_0.5px_var(--blue-600)] disabled:bg-surface-muted disabled:text-ink-400 aria-[invalid=true]:border-pink";

export type FieldIds = { control: string; description?: string };

type FieldProps = {
  label: string;
  /** Shows "(Optional)" after the label. */
  optional?: boolean;
  hint?: string;
  error?: string;
  /** Character count, as [used, max]. */
  count?: [number, number];
  /** Hide the label visually but keep it for screen readers (search, table filters). */
  hideLabel?: boolean;
  className?: string;
  children: (ids: FieldIds) => ReactNode;
};

/** Label above, then the control, then the error or hint (docs/DESIGN.md Section 7, Input). */
export function Field({
  label,
  optional,
  hint,
  error,
  count,
  hideLabel,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const control = `${id}-control`;
  const message = error || hint ? `${id}-message` : undefined;
  const counter = count ? `${id}-count` : undefined;
  const description = [message, counter].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className={cx("flex items-baseline justify-between gap-2", hideLabel && "sr-only")}>
        <label htmlFor={control} className="text-small text-ink-600 font-semibold">
          {label}
          {optional && <span className="text-ink-500 font-medium"> (Optional)</span>}
        </label>
      </div>
      {children({ control, description })}
      {(message || counter) && (
        <div className="flex items-start justify-between gap-2">
          {message ? (
            <p
              id={message}
              className={cx(
                "text-small flex items-center gap-1",
                error ? "text-pink-text" : "text-ink-500",
              )}
            >
              {error && <WarningCircle aria-hidden size={16} weight="fill" />}
              {error || hint}
            </p>
          ) : (
            <span />
          )}
          {count && (
            <span
              id={counter}
              className={cx(
                "text-small tnum shrink-0",
                count[0] > count[1] ? "text-pink-text" : "text-ink-500",
              )}
            >
              {count[0]}/{count[1]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
