"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

import { FOCUS_RING } from "./focus";

export type TabItem = { value: string; label: string; count?: number; content: ReactNode };

type Props = {
  /** Screen-reader name for the tab list. */
  label: string;
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

/** Text tabs with a 2 px blue underline on the active one (docs/DESIGN.md Section 7). */
export function Tabs({ label, items, value, defaultValue, onValueChange }: Props) {
  return (
    <RadixTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      className="flex flex-col gap-4"
    >
      <RadixTabs.List
        aria-label={label}
        className="border-line flex gap-6 overflow-x-auto border-b"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={cx(
              "text-body text-ink-500 hover:text-ink-900 data-[state=active]:text-blue-600 -mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent font-semibold transition-colors duration-150 ease-out data-[state=active]:border-blue-600",
              FOCUS_RING,
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="text-small text-ink-500 tnum font-medium">{item.count}</span>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className={FOCUS_RING}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
