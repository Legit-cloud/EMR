"use client";

import { useCallback, useEffect, useState } from "react";

/** undefined while loading, "forbidden" when the API refuses, otherwise the data. */
export type Loaded<T> = T | "forbidden" | undefined;

type Fetched = Promise<{ data?: unknown; response: Response }>;

/**
 * Load data from the API and reload it after a change. List endpoints are paginated, so
 * ``results`` is unwrapped. Access is decided by the API; 403 becomes "forbidden".
 */
export function useLoad<T>(fetcher: () => Fetched, deps: unknown[]): [Loaded<T>, () => Promise<void>] {
  const [value, setValue] = useState<Loaded<T>>(undefined);
  const load = useCallback(fetcher, deps);
  const reload = useCallback(async () => {
    const { data, response } = await load();
    if (response.status === 403) return setValue("forbidden");
    const unwrapped =
      data && typeof data === "object" && "results" in data ? (data as { results: T }).results : data;
    setValue(unwrapped as T);
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);
  return [value, reload];
}
