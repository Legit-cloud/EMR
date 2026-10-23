import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";

/** Patients' data-protection requests, as the compliance team sees them (docs/adr/0024). */
export type StaffRequest = Schemas["StaffRequest"];
export type RequestStatus = Schemas["DataRequestStatusEnum"];

export type RequestFilters = {
  status: string;
  overdueOnly: boolean;
  page: number;
  pageSize: number;
};

export function useDataRequests({ status, overdueOnly, page, pageSize }: RequestFilters) {
  return useQuery({
    queryKey: ["data-requests", { status, overdueOnly, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/portal/data-requests/", {
          params: {
            query: {
              status: status === "all" ? undefined : status,
              overdue: overdueOnly ? "true" : undefined,
              page,
              page_size: String(pageSize),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useRespond(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["RespondRequest"]) =>
      unwrap(
        api.POST("/api/portal/data-requests/{id}/respond/", { params: { path: { id } }, body }),
      ),
    onSettled: () => client.invalidateQueries({ queryKey: ["data-requests"] }),
    meta: { quietErrors: true },
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

/** "Due 12 Nov 2026", "3 days late" or "Due today", to put next to the date. */
export function dueText(dueOn: string, today: Date = new Date()): string {
  const days = Math.round(
    (Date.parse(dueOn) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000,
  );
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} late`;
  if (days === 0) return "Due today";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
