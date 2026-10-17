import { useId } from "react";

import { cx } from "@/lib/cx";

import { FOCUS_WITHIN_RING } from "./focus";

export type Choice = { value: string; label: string; description?: string };

type GroupProps = {
  legend: string;
  /** Hide the legend visually when the surrounding text already names the group. */
  hideLegend?: boolean;
  options: Choice[];
  value?: string;
  onValueChange?: (value: string) => void;
  /** Form field name; generated when absent. */
  name?: string;
  error?: string;
};

/** Native radios, so arrow keys, Tab and screen readers behave as users expect. */
function RadioGroup({
  legend,
  hideLegend,
  options,
  value,
  onValueChange,
  name,
  error,
  layout,
  item,
}: GroupProps & { layout: string; item: string }) {
  const generated = useId();
  const errorId = `${generated}-error`;
  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      className="flex min-w-0 flex-col gap-1.5"
    >
      <legend
        className={cx("text-small text-ink-600 mb-1.5 font-semibold", hideLegend && "sr-only")}
      >
        {legend}
      </legend>
      <div className={layout}>
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cx(
                "border-line bg-surface text-body text-ink-900 hover:border-ink-300 flex cursor-pointer items-center gap-2.5 border transition-colors duration-150 ease-out",
                "has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50",
                FOCUS_WITHIN_RING,
                item,
              )}
            >
              <input
                type="radio"
                name={name ?? generated}
                value={option.value}
                checked={value === undefined ? undefined : checked}
                onChange={() => onValueChange?.(option.value)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="border-ink-300 peer-checked:border-blue-600 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] after:size-2.5 after:scale-0 after:rounded-full after:bg-blue-600 after:transition-transform after:duration-150 peer-checked:after:scale-100 motion-reduce:after:transition-none"
              />
              <span className="flex flex-col">
                <span className="font-semibold">{option.label}</span>
                {option.description && (
                  <span className="text-small text-ink-500">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="text-small text-pink-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Pill-like bordered radios for short choices: gender, yes or no. */
export function ChoiceChips(props: GroupProps) {
  return <RadioGroup {...props} layout="flex flex-wrap gap-2" item="rounded-pill h-11 px-4" />;
}

/** Bordered radio tiles in a 2 or 3 column grid (questionnaires). */
export function RadioCards({ columns = 2, ...props }: GroupProps & { columns?: 2 | 3 }) {
  return (
    <RadioGroup
      {...props}
      layout={cx("grid gap-3", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}
      item="rounded-control min-h-14 px-4 py-3"
    />
  );
}
