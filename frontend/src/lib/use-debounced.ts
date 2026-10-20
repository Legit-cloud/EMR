"use client";

import { useEffect, useState } from "react";

/** The value, once it has stopped changing for `delayMs`. Pass a primitive: a new object on
 * every render would never settle. */
export function useDebounced<T>(value: T, delayMs = 500): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}
