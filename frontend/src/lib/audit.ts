import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, ApiRequestError, apiError, type Schemas, unwrap } from "@/lib/api";

export type AuditEntry = Schemas["AuditEntry"];
export type AuditSummary = Schemas["AuditSummary"];
export type AuditAction = AuditEntry["action"];

export type AuditFilters = {
  q: string;
  action: string;
  outcome: string;
  dateFrom: string;
  dateTo: string;
};

export const NO_FILTERS: AuditFilters = {
  q: "",
  action: "all",
  outcome: "all",
  dateFrom: "",
  dateTo: "",
};

/** How many filters (not counting the search box) are on. */
export function activeFilters(filters: AuditFilters): number {
  return (
    (filters.action !== "all" ? 1 : 0) +
    (filters.outcome !== "all" ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0)
  );
}

/** A break-glass event, or the compliance review of one: rows that get the pink tint. */
export const isBreakGlass = (entry: Pick<AuditEntry, "action">) =>
  entry.action === "break_glass" || entry.action === "break_glass_review";

/** The filters as API query parameters. Empty ones are left out. */
export function toQuery(filters: AuditFilters) {
  return {
    q: filters.q || undefined,
    action: filters.action === "all" ? undefined : filters.action,
    outcome: filters.outcome === "all" ? undefined : filters.outcome,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
}

export const ACTIONS: AuditAction[] = [
  "read",
  "create",
  "update",
  "delete",
  "access",
  "login",
  "login_failed",
  "logout",
  "password_reset_request",
  "password_reset",
  "break_glass",
  "break_glass_review",
];

export function useAuditList(filters: AuditFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["audit", "list", filters, page, pageSize],
    queryFn: () =>
      unwrap(
        api.GET("/api/audit/entries/", {
          params: { query: { ...toQuery(filters), page, page_size: String(pageSize) } },
        }),
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAuditSummary(filters: AuditFilters) {
  return useQuery({
    queryKey: ["audit", "summary", filters],
    queryFn: () =>
      unwrap(api.GET("/api/audit/entries/summary/", { params: { query: toQuery(filters) } })),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** The latest break-glass entries under the current search and dates, pinned above the table. */
export function useBreakGlassEntries(filters: AuditFilters) {
  return useQuery({
    queryKey: ["audit", "break-glass", filters.q, filters.dateFrom, filters.dateTo],
    queryFn: () =>
      unwrap(
        api.GET("/api/audit/entries/", {
          params: {
            query: {
              ...toQuery({
                ...NO_FILTERS,
                q: filters.q,
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
              }),
              action: "break_glass",
              page: 1,
              page_size: "5",
            },
          },
        }),
      ),
    retry: false,
  });
}

/** Download the filtered log as a CSV. Throws an ApiRequestError if the server refuses. */
export async function downloadAuditCsv(filters: AuditFilters): Promise<void> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(toQuery(filters))) {
    if (value) params.set(key, value);
  }
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  const response = await globalThis.fetch(`${base}/api/audit/entries/export/?${params}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiRequestError(response.status, apiError(body));
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "audit-log.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
