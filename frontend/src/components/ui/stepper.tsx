import { Check, type Icon } from "@phosphor-icons/react";
import { Fragment } from "react";

import { cx } from "@/lib/cx";

export type Step = { label: string; icon: Icon };

export type StepState = "done" | "active" | "upcoming";

export function stepState(index: number, current: number): StepState {
  if (index < current) return "done";
  return index === current ? "active" : "upcoming";
}

const CIRCLE: Record<StepState, string> = {
  done: "bg-green-btn text-surface",
  active: "bg-blue-600 text-surface",
  upcoming: "bg-pill-grey text-ink-500",
};

const STATE_TEXT: Record<StepState, string> = {
  done: "completed",
  active: "current step",
  upcoming: "not started",
};

/** Wizard stepper: done green with a check, active blue, upcoming grey (docs/DESIGN.md Section 7). */
export function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol aria-label="Progress" className="flex items-center gap-3">
      {steps.map((step, index) => {
        const state = stepState(index, current);
        const Glyph = state === "done" ? Check : step.icon;
        return (
          <Fragment key={step.label}>
            {index > 0 && (
              <li
                aria-hidden
                className={cx(
                  "h-0.5 min-w-4 flex-1 rounded-full",
                  index <= current ? "bg-green-btn" : "bg-line",
                )}
              />
            )}
            <li
              aria-current={state === "active" ? "step" : undefined}
              className="flex items-center gap-2.5"
            >
              <span
                aria-hidden
                className={cx(
                  "grid size-9 shrink-0 place-items-center rounded-full",
                  CIRCLE[state],
                )}
              >
                <Glyph size={18} weight={state === "upcoming" ? "regular" : "bold"} />
              </span>
              {/* On phones only the current step keeps its label; screen readers get all. */}
              <span
                className={cx(
                  "flex-col",
                  state === "active" ? "flex" : "sr-only sm:not-sr-only sm:flex",
                )}
              >
                <span className="text-label-caps text-ink-500 uppercase">Step {index + 1}</span>
                <span
                  className={cx(
                    "text-body font-semibold",
                    state === "upcoming" ? "text-ink-500" : "text-ink-900",
                  )}
                >
                  {step.label}
                  <span className="sr-only">, {STATE_TEXT[state]}</span>
                </span>
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
