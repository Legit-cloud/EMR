import type { Icon } from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type Ref,
  type TextareaHTMLAttributes,
  useState,
} from "react";

import { cx } from "@/lib/cx";

import { CONTROL, Field } from "./field";

type Common = {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  /** Shows a "42/200" counter; needs maxLength. */
  showCount?: boolean;
  className?: string;
};

/** Tracks the length for the counter, whether the field is controlled or not. */
function useCount<E extends HTMLInputElement | HTMLTextAreaElement>(
  value: unknown,
  defaultValue: unknown,
  onChange?: (event: ChangeEvent<E>) => void,
) {
  const [typed, setTyped] = useState(String(defaultValue ?? "").length);
  const used = value !== undefined ? String(value ?? "").length : typed;
  function handle(event: ChangeEvent<E>) {
    setTyped(event.target.value.length);
    onChange?.(event);
  }
  return [used, handle] as const;
}

type InputProps = Common &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
    /** 16 px icon inside on the left: phone, email, clock, calendar. */
    icon?: Icon;
    ref?: Ref<HTMLInputElement>;
  };

/** 44 px text input with label, optional marker, counter and error (docs/DESIGN.md Section 7). */
export function Input({
  label,
  optional,
  hint,
  error,
  hideLabel,
  showCount,
  className,
  icon: Glyph,
  value,
  defaultValue,
  onChange,
  maxLength,
  ...props
}: InputProps) {
  const [used, handle] = useCount(value, defaultValue, onChange);
  return (
    <Field
      label={label}
      optional={optional}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      count={showCount && maxLength ? [used, maxLength] : undefined}
      className={className}
    >
      {({ control, description }) => (
        <div className="relative">
          {Glyph && (
            <Glyph
              aria-hidden
              size={16}
              className="text-ink-500 pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
            />
          )}
          <input
            id={control}
            aria-describedby={description}
            aria-invalid={error ? true : undefined}
            value={value}
            defaultValue={defaultValue}
            onChange={handle}
            maxLength={maxLength}
            className={cx(CONTROL, "h-11", Glyph ? "pr-3.5 pl-10" : "px-3.5")}
            {...props}
          />
        </div>
      )}
    </Field>
  );
}

type TextareaProps = Common &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
    ref?: Ref<HTMLTextAreaElement>;
  };

/** Resizable textarea with the same label, counter and error as Input. */
export function Textarea({
  label,
  optional,
  hint,
  error,
  hideLabel,
  showCount,
  className,
  value,
  defaultValue,
  onChange,
  maxLength,
  rows = 4,
  ...props
}: TextareaProps) {
  const [used, handle] = useCount(value, defaultValue, onChange);
  return (
    <Field
      label={label}
      optional={optional}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      count={showCount && maxLength ? [used, maxLength] : undefined}
      className={className}
    >
      {({ control, description }) => (
        <textarea
          id={control}
          aria-describedby={description}
          aria-invalid={error ? true : undefined}
          value={value}
          defaultValue={defaultValue}
          onChange={handle}
          maxLength={maxLength}
          rows={rows}
          className={cx(CONTROL, "min-h-24 resize-y px-3.5 py-2.5")}
          {...props}
        />
      )}
    </Field>
  );
}
