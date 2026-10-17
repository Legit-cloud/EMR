"use client";

import { CaretDown, Check } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import { type KeyboardEvent, useId, useRef, useState } from "react";

import { cx } from "@/lib/cx";

import { CONTROL, Field } from "./field";
import type { Option } from "./select";

type Props = {
  label: string;
  options: Option[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** Shown when the search matches nothing. */
  emptyText?: string;
  className?: string;
};

/** Searchable select for long lists (formulary, ICD-10 codes, physicians). ARIA 1.2 combobox. */
export function Combobox({
  label,
  options,
  value,
  onValueChange,
  placeholder = "Search",
  optional,
  hint,
  error,
  disabled,
  emptyText = "No matches",
  className,
}: Props) {
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value) ?? null;
  const needle = query.trim().toLowerCase();
  const matches = (
    needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options
  ).filter((o) => !o.disabled);
  const activeOption = open ? matches[Math.min(active, matches.length - 1)] : undefined;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function choose(option: Option) {
    onValueChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function openList() {
    if (disabled) return;
    const current = selected ? matches.findIndex((o) => o.value === selected.value) : 0;
    setActive(Math.max(current, 0));
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (Math.min(i, matches.length - 1) + step + matches.length) % matches.length);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (activeOption) choose(activeOption);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery("");
      } else if (selected) {
        onValueChange(null);
      }
    }
  }

  return (
    <Field label={label} optional={optional} hint={hint} error={error} className={className}>
      {({ control, description }) => (
        <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
          <Popover.Anchor asChild>
            <div ref={anchor} className="relative">
              <input
                id={control}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={
                  activeOption ? optionId(matches.indexOf(activeOption)) : undefined
                }
                aria-describedby={description}
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                disabled={disabled}
                placeholder={placeholder}
                value={open ? query : (selected?.label ?? "")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                  setOpen(true);
                }}
                onClick={openList}
                onKeyDown={onKeyDown}
                onBlur={() => {
                  setOpen(false);
                  setQuery("");
                }}
                className={cx(CONTROL, "h-11 pr-10 pl-3.5")}
              />
              <CaretDown
                aria-hidden
                size={16}
                className="text-ink-500 pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2"
              />
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (anchor.current?.contains(event.target as Node)) event.preventDefault();
              }}
              className="rounded-menu border-line bg-surface shadow-pop z-50 w-(--radix-popover-trigger-width) border p-1"
            >
              <ul
                id={listId}
                role="listbox"
                aria-label={label}
                className="max-h-72 overflow-y-auto"
              >
                {matches.length === 0 && (
                  <li
                    role="presentation"
                    className="text-body text-ink-500 flex h-10 items-center px-3"
                  >
                    {emptyText}
                  </li>
                )}
                {matches.map((option, index) => {
                  const isSelected = option.value === value;
                  return (
                    // Keys are handled on the input (aria-activedescendant); options never take focus.
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                    <li
                      key={option.value}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isSelected}
                      // Keep focus in the input so typing and arrow keys keep working.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                      onMouseMove={() => setActive(index)}
                      className={cx(
                        "rounded-control text-body text-ink-900 flex h-10 cursor-pointer items-center justify-between gap-3 px-3",
                        option === activeOption && "bg-nav-hover",
                      )}
                    >
                      {option.label}
                      {isSelected && (
                        <Check aria-hidden size={16} weight="bold" className="text-blue-600" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Field>
  );
}
