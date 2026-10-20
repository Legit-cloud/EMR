"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactElement, ReactNode } from "react";

import { cx } from "@/lib/cx";

type Props = {
  /** The button that opens the panel; it gets the open state and keyboard handling. */
  trigger: ReactElement;
  /** Names the panel for screen readers, for example "Filters". */
  title: string;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
};

/**
 * A white panel anchored to a button, for filters and small forms (docs/DESIGN.md Section 4:
 * popover shadow, radius 12). Focus moves into the panel and returns to the button on close.
 */
export function Popover({ trigger, title, children, align = "end", className }: Props) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={title}
          align={align}
          sideOffset={8}
          className={cx(
            "rounded-menu border-line bg-surface shadow-pop data-[state=open]:animate-pop-in z-50 w-72 border p-4 motion-reduce:animate-none focus:outline-none",
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
