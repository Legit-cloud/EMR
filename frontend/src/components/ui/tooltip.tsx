"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

/** Wrap the app (or a test) once; Tooltip needs it. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

/**
 * Dark hint on hover and keyboard focus: ink-900 fill, white text, radius 8. The trigger must
 * already have an accessible name; the tooltip adds detail and never replaces a label.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className="rounded-cal bg-ink-900 text-small text-surface shadow-pop z-50 max-w-64 px-2.5 py-1.5"
        >
          {content}
          <RadixTooltip.Arrow className="fill-ink-900" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
