"use client";

import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";
import * as RadixToast from "@radix-ui/react-toast";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

import { cx } from "@/lib/cx";

import { FOCUS_RING } from "./focus";

export type ToastTone = "success" | "error" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** A button on the toast, for example "Undo". Closing the toast does not run it. */
  action?: { label: string; onClick: () => void };
  /** How long it stays, in ms; the default suits a short message. Errors stay regardless. */
  durationMs?: number;
};

type Entry = ToastInput & { id: number };

/** Successes and info go after 4 s; errors stay until dismissed (docs/DESIGN.md Section 7). */
export const TOAST_DURATION = 4000;

const TONE = {
  success: { icon: CheckCircle, className: "text-green" },
  error: { icon: WarningCircle, className: "text-pink" },
  info: { icon: Info, className: "text-sky" },
} as const;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Shows a toast. Call inside ToastProvider. */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}

let nextId = 1;

/** Holds the toast queue and the bottom-right viewport. Radix announces toasts politely. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Entry[]>([]);
  const show = useCallback((toast: ToastInput) => {
    setToasts((list) => [...list, { ...toast, id: nextId++ }]);
  }, []);
  const remove = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={show}>
      <RadixToast.Provider swipeDirection="right" label="Notifications">
        {children}
        {toasts.map(({ id, title, description, tone = "success", action, durationMs }) => {
          const { icon: Glyph, className } = TONE[tone];
          return (
            <RadixToast.Root
              key={id}
              type={tone === "error" ? "foreground" : "background"}
              duration={tone === "error" ? Infinity : (durationMs ?? TOAST_DURATION)}
              onOpenChange={(open) => !open && remove(id)}
              className="rounded-card border-line bg-surface shadow-pop data-[state=open]:animate-toast-in flex w-full items-start gap-3 border p-4 motion-reduce:animate-none"
            >
              <Glyph aria-hidden size={22} weight="fill" className={cx("shrink-0", className)} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <RadixToast.Title className="text-body text-ink-900 font-semibold">
                  {title}
                </RadixToast.Title>
                {description && (
                  <RadixToast.Description className="text-small text-ink-600">
                    {description}
                  </RadixToast.Description>
                )}
              </div>
              {action && (
                <RadixToast.Action
                  altText={action.label}
                  onClick={action.onClick}
                  className={cx(
                    "rounded-control text-small shrink-0 px-2 py-1 font-semibold text-blue-600 hover:underline",
                    FOCUS_RING,
                  )}
                >
                  {action.label}
                </RadixToast.Action>
              )}
              <RadixToast.Close
                aria-label="Dismiss"
                className={cx(
                  "rounded-control text-ink-500 hover:text-ink-900 -m-1 grid size-8 shrink-0 place-items-center",
                  FOCUS_RING,
                )}
              >
                <X aria-hidden size={16} />
              </RadixToast.Close>
            </RadixToast.Root>
          );
        })}
        <RadixToast.Viewport className="fixed right-0 bottom-0 z-[60] flex w-full max-w-sm flex-col gap-3 p-4 outline-none sm:p-6" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
