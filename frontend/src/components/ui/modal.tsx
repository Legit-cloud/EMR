"use client";

import { X } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

import { IconButton } from "./button";
import { useReturnFocus } from "./return-focus";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line under the title; also read out when the modal opens. */
  description?: string;
  /** 560 px for wizards, 480 px for confirmations. */
  size?: "wizard" | "confirm";
  /** Stepper or other content pinned above the scrolling body. */
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

/** Radius 16 modal with a scrolling body and a sticky footer (docs/DESIGN.md Section 7). */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = "wizard",
  header,
  footer,
  children,
}: Props) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim data-[state=open]:animate-fade-in fixed inset-0 z-50 motion-reduce:animate-none" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cx(
            "rounded-modal bg-surface shadow-modal data-[state=open]:animate-pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col focus:outline-none motion-reduce:animate-none",
            size === "wizard" ? "max-w-[560px]" : "max-w-[480px]",
          )}
        >
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-ink-900 text-base font-bold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-small text-ink-600">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton icon={X} label="Close" className="-mt-1 -mr-2" />
            </Dialog.Close>
          </div>
          {header && <div className="px-6 pb-4">{header}</div>}
          <div className="flex-1 overflow-y-auto px-6 pb-5">{children}</div>
          {footer && <div className="border-line border-t px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Footer layout: Cancel (text) on the left, Previous and Next or Save on the right. */
export function ModalFooter({ start, end }: { start?: ReactNode; end: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>{start}</div>
      <div className="flex items-center gap-3">{end}</div>
    </div>
  );
}
