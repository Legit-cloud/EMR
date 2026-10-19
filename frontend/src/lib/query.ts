import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { apiError, ApiRequestError } from "./api";

/** How long fetched data counts as fresh before a remount or refocus refetches it. */
export const STALE_TIME = 30_000;
const MAX_RETRIES = 2;

/**
 * Retry network failures and server errors, never a 4xx: a refusal, a missing record or
 * invalid input will not change by asking again.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

/** Errors the user is told about elsewhere: signing out redirects, refusals show in place. */
function handledElsewhere(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Set when the screen shows the error itself (a form with field errors). */
      quietErrors?: boolean;
    };
  }
}

/**
 * The app's QueryClient. `notify` shows a toast for errors no screen is showing: a failed
 * save, or a background refresh failing while the screen still shows older data. A query
 * that fails on first load shows its own error state instead.
 */
export function createQueryClient(notify: (message: string) => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError(error, query) {
        if (query.state.data !== undefined && !handledElsewhere(error)) {
          notify("Could not refresh. Showing the last data loaded.");
        }
      },
    }),
    mutationCache: new MutationCache({
      onError(error, _variables, _context, mutation) {
        if (mutation.meta?.quietErrors || handledElsewhere(error)) return;
        notify(apiError(error).message);
      },
    }),
    defaultOptions: {
      queries: { staleTime: STALE_TIME, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
