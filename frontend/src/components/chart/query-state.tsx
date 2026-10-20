"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Button } from "@/components/ui/button";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api";

type Props<T> = {
  query: UseQueryResult<T>;
  /** What this shows, for messages: "vital signs". */
  what: string;
  /** How many skeleton rows to show while loading. */
  rows?: number;
  children: (data: T) => ReactNode;
};

/** Loading skeleton, "no access" (403), retryable error, or the data: the states every
 * chart section handles. */
export function QueryState<T>({ query, what, rows = 3, children }: Props<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    if (query.error instanceof ApiRequestError && query.error.status === 403) {
      return <NoAccess compact what={what} />;
    }
    return (
      <div role="alert" className="text-small text-ink-600 flex flex-wrap items-center gap-3 py-2">
        <span>{what[0].toUpperCase() + what.slice(1)} could not be loaded.</span>
        <Button variant="outline" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <Loading label={`Loading ${what}`}>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Loading>
  );
}
