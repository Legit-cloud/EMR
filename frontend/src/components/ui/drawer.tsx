"use client";

import { type Icon, X } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

import { IconButton } from "./button";
import { FOCUS_RING } from "./focus";
import { useReturnFocus } from "./return-focus";

export type DrawerSection = { value: string; label: string; icon: Icon; content: ReactNode };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read out as the dialog name, for example "Appointment #APT0011". */
  title: string;
  /** Visible header content; defaults to the title. Holds the ID, type tag and edit icon. */
  heading?: ReactNode;
  /** Sections switched by the icon rail on the drawer's left edge. */
  sections: DrawerSection[];
  section?: string;
  onSectionChange?: (value: string) => void;
  footer?: ReactNode;
};

/** Right slide-over, 540 px, radius 16 on the left corners, with an icon-tab rail (Section 7). */
export function Drawer({
  open,
  onOpenChange,
  title,
  heading,
  sections,
  section,
  onSectionChange,
  footer,
}: Props) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim data-[state=open]:animate-fade-in fixed inset-0 z-50 motion-reduce:animate-none" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          aria-describedby={undefined}
          className="rounded-l-modal bg-surface shadow-modal data-[state=open]:animate-drawer-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[540px] focus:outline-none motion-reduce:animate-none"
        >
          <RadixTabs.Root
            orientation="vertical"
            value={section}
            defaultValue={section === undefined ? sections[0]?.value : undefined}
            onValueChange={onSectionChange}
            className="flex min-w-0 flex-1"
          >
            {sections.length > 1 && (
              <RadixTabs.List
                aria-label="Sections"
                className="border-line bg-surface-muted rounded-l-modal flex w-14 shrink-0 flex-col items-center gap-2 border-r py-5"
              >
                {sections.map(({ value, label, icon: Glyph }) => (
                  <RadixTabs.Trigger
                    key={value}
                    value={value}
                    aria-label={label}
                    title={label}
                    className={cx(
                      "rounded-control text-ink-500 hover:bg-nav-hover hover:text-ink-900 data-[state=active]:bg-blue-100 data-[state=active]:text-blue-600 grid size-10 place-items-center",
                      FOCUS_RING,
                    )}
                  >
                    <Glyph aria-hidden size={20} weight="duotone" />
                  </RadixTabs.Trigger>
                ))}
              </RadixTabs.List>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="border-line flex items-center justify-between gap-3 border-b px-6 py-4">
                {heading ? (
                  <>
                    <Dialog.Title className="sr-only">{title}</Dialog.Title>
                    <div className="flex min-w-0 items-center gap-2">{heading}</div>
                  </>
                ) : (
                  <Dialog.Title className="text-ink-900 text-base font-bold">{title}</Dialog.Title>
                )}
                <Dialog.Close asChild>
                  <IconButton icon={X} label="Close" className="-mr-2" />
                </Dialog.Close>
              </div>
              {sections.map(({ value, content }) => (
                <RadixTabs.Content
                  key={value}
                  value={value}
                  className={cx("flex-1 overflow-y-auto px-6 py-5", FOCUS_RING)}
                >
                  {content}
                </RadixTabs.Content>
              ))}
              {footer && <div className="border-line border-t px-6 py-4">{footer}</div>}
            </div>
          </RadixTabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
