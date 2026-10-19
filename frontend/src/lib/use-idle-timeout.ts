"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Sign out after this long without activity, warning shortly before. */
export const IDLE_LIMIT_MS = 15 * 60_000;
export const IDLE_WARNING_MS = 2 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
// Shared by every tab of the app, so working in one tab keeps the others signed in.
const STORAGE_KEY = "emr.last-activity";
const CHECK_EVERY_MS = 1000;

function shareActivity(at: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(at));
  } catch {
    // Storage can be blocked; each tab then times out on its own.
  }
}

type Options = {
  onTimeout: () => void;
  limitMs?: number;
  warningMs?: number;
};

/**
 * Tracks activity in the signed-in app. `warning` turns on `warningMs` before the limit;
 * from then on only `stayActive` (the "Stay signed in" button) counts, so a stray key
 * press cannot silently dismiss the warning. At the limit `onTimeout` runs once.
 */
export function useIdleTimeout({
  onTimeout,
  limitMs = IDLE_LIMIT_MS,
  warningMs = IDLE_WARNING_MS,
}: Options) {
  // Set when the effect below starts, which is when the clock starts.
  const lastActivity = useRef(0);
  const warningRef = useRef(false);
  const timedOut = useRef(false);
  const timeoutRef = useRef(onTimeout);
  const [warning, setWarning] = useState(false);
  const [deadline, setDeadline] = useState(() => Date.now() + limitMs);

  useEffect(() => {
    timeoutRef.current = onTimeout;
  }, [onTimeout]);

  const markActive = useCallback(
    (at = Date.now()) => {
      lastActivity.current = at;
      warningRef.current = false;
      setWarning(false);
      setDeadline(at + limitMs);
    },
    [limitMs],
  );

  const stayActive = useCallback(() => {
    const now = Date.now();
    markActive(now);
    shareActivity(now);
  }, [markActive]);

  useEffect(() => {
    lastActivity.current = Date.now();
    let lastShared = 0;
    function onActivity() {
      if (warningRef.current) return;
      const now = Date.now();
      lastActivity.current = now;
      // Writing storage on every key press is wasteful; once every few seconds is enough.
      if (now - lastShared > 5000) {
        lastShared = now;
        shareActivity(now);
        setDeadline(now + limitMs);
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      const at = Number(event.newValue);
      if (at > lastActivity.current) markActive(at);
    }
    for (const name of ACTIVITY_EVENTS)
      window.addEventListener(name, onActivity, { passive: true });
    window.addEventListener("storage", onStorage);

    const id = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= limitMs) {
        if (!timedOut.current) {
          timedOut.current = true;
          timeoutRef.current();
        }
        return;
      }
      const warn = idle >= limitMs - warningMs;
      if (warn !== warningRef.current) {
        warningRef.current = warn;
        setWarning(warn);
        setDeadline(lastActivity.current + limitMs);
      }
    }, CHECK_EVERY_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, [limitMs, warningMs, markActive]);

  return { warning, deadline, stayActive };
}
