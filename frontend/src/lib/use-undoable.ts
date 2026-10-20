"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";

import { apiError } from "./api";

/** How long the user has to undo. A test hook: tests shorten it instead of waiting. */
export const undoConfig = { delayMs: 6000 };

type Pending = { timer: number; run: () => Promise<void> };

/**
 * Actions the user may take back for a few seconds. `schedule` hides the item at once and
 * shows a toast with Undo; the real request is sent when the time is up. The API has no way
 * to un-do "entered in error", so nothing is sent until the user has had the chance to change
 * their mind. Anything still waiting is sent when the screen goes away, so a hidden item is
 * never left looking correct on screen but wrong on the server for long.
 */
export function useUndoable(delayMs = undoConfig.delayMs) {
  const toast = useToast();
  const pending = useRef(new Map<string, Pending>());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const unhide = useCallback((id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const schedule = useCallback(
    ({ id, message, commit }: { id: string; message: string; commit: () => Promise<unknown> }) => {
      setHidden((current) => new Set(current).add(id));
      const run = async () => {
        pending.current.delete(id);
        try {
          await commit();
        } catch (failure) {
          unhide(id);
          toast({
            title: "Could not save that change",
            description: apiError(failure).message,
            tone: "error",
          });
        }
      };
      pending.current.set(id, { timer: window.setTimeout(run, delayMs), run });
      toast({
        title: message,
        tone: "info",
        durationMs: delayMs,
        action: {
          label: "Undo",
          onClick: () => {
            const waiting = pending.current.get(id);
            if (!waiting) return; // already sent: the record really is hidden now
            window.clearTimeout(waiting.timer);
            pending.current.delete(id);
            unhide(id);
          },
        },
      });
    },
    [delayMs, toast, unhide],
  );

  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const { timer, run } of waiting.values()) {
        window.clearTimeout(timer);
        void run();
      }
    };
  }, []);

  return { hidden, schedule };
}
