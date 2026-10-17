import { useId } from "react";

import { cx } from "@/lib/cx";

import { FOCUS_WITHIN_RING } from "./focus";

type Props<T extends string> = {
  /** Screen-reader name, for example "Calendar view". */
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
};

/** Two or three options in a pill track; the active one is white with a shadow ("Day" / "Week"). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
}: Props<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="rounded-pill bg-search-fill inline-flex h-10 items-center gap-1 p-1"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            "rounded-pill text-body text-ink-600 hover:text-ink-900 has-[:checked]:bg-surface has-[:checked]:text-ink-900 has-[:checked]:shadow-card flex h-8 cursor-pointer items-center px-4 font-semibold transition-colors duration-150 ease-out",
            FOCUS_WITHIN_RING,
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onValueChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
