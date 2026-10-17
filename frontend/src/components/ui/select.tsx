"use client";

import { CaretDown, Check } from "@phosphor-icons/react";
import * as RadixSelect from "@radix-ui/react-select";

import { cx } from "@/lib/cx";

import { CONTROL, Field } from "./field";
import { FOCUS_RING } from "./focus";

export type Option = { value: string; label: string; disabled?: boolean };

const POPOVER =
  "rounded-menu border-line bg-surface shadow-pop z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden border p-1";
const OPTION =
  "rounded-control text-body text-ink-900 data-[highlighted]:bg-nav-hover data-[disabled]:text-ink-400 relative flex h-10 cursor-pointer items-center justify-between gap-3 px-3 outline-none select-none";

function Options({ options }: { options: Option[] }) {
  return (
    <RadixSelect.Viewport>
      {options.map((option) => (
        <RadixSelect.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={OPTION}
        >
          <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
          <RadixSelect.ItemIndicator>
            <Check aria-hidden size={16} weight="bold" className="text-blue-600" />
          </RadixSelect.ItemIndicator>
        </RadixSelect.Item>
      ))}
    </RadixSelect.Viewport>
  );
}

type SelectProps = {
  label: string;
  options: Option[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  /** Submits the value with a plain form. */
  name?: string;
  className?: string;
};

/** Input-styled select for short lists; use Combobox when the list needs searching. */
export function Select({
  label,
  options,
  placeholder = "Select",
  optional,
  hint,
  error,
  hideLabel,
  className,
  ...root
}: SelectProps) {
  return (
    <Field
      label={label}
      optional={optional}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={className}
    >
      {({ control, description }) => (
        <RadixSelect.Root {...root}>
          <RadixSelect.Trigger
            id={control}
            aria-describedby={description}
            aria-invalid={error ? true : undefined}
            className={cx(
              CONTROL,
              "data-[placeholder]:text-ink-400 flex h-11 items-center justify-between gap-2 px-3.5 text-left",
            )}
          >
            <RadixSelect.Value placeholder={placeholder} />
            <RadixSelect.Icon>
              <CaretDown aria-hidden size={16} className="text-ink-500" />
            </RadixSelect.Icon>
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content position="popper" sideOffset={6} className={POPOVER}>
              <Options options={options} />
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
      )}
    </Field>
  );
}

type RangeSelectProps = {
  /** Screen-reader name, for example "Cashflow period". */
  label: string;
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
};

/** Small outline pill dropdown for a card's top-right: "Last 12 months ▾". */
export function RangeSelect({ label, options, value, onValueChange }: RangeSelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        aria-label={label}
        className={cx(
          "rounded-pill border-line bg-surface text-small text-ink-900 hover:border-ink-300 inline-flex h-8 shrink-0 items-center gap-1.5 border px-3 font-semibold whitespace-nowrap",
          FOCUS_RING,
        )}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <CaretDown aria-hidden size={14} className="text-ink-500" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={6} align="end" className={POPOVER}>
          <Options options={options} />
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
