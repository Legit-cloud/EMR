import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";

/** Laboratory and imaging orders and their results (docs/adr/0025). */
export type DiagnosticOrder = Schemas["DiagnosticOrder"];
export type DiagnosticResult = Schemas["Result"];
export type Investigation = Schemas["Investigation"];
export type OrderStatus = Schemas["DiagnosticOrderStatusEnum"];
export type Flag = Schemas["ResultFlagEnum"];
export type Priority = Schemas["OrderPriorityEnum"];

export const KIND_LABEL: Record<string, string> = { lab: "Laboratory", imaging: "Imaging" };

export const PRIORITY_LABEL: Record<Priority, string> = {
  routine: "Routine",
  urgent: "Urgent",
  stat: "Immediately",
};

export const FLAG_LABEL: Record<Flag, string> = {
  normal: "Normal",
  abnormal: "Abnormal",
  critical: "Critical",
};

export type OrderFilters = { status: string; kind: string; page: number; pageSize: number };

export function useOrders({ status, kind, page, pageSize }: OrderFilters) {
  return useQuery({
    queryKey: ["diagnostics", "orders", { status, kind, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/diagnostics/orders/", {
          params: {
            query: {
              status: status === "all" ? undefined : status,
              kind: kind === "all" ? undefined : kind,
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

/** One patient's tests and scans, newest first, for the chart. */
export function usePatientOrders(patient: string) {
  return useQuery({
    queryKey: ["diagnostics", "patient", patient],
    queryFn: () =>
      unwrap(api.GET("/api/diagnostics/orders/", { params: { query: { patient } } })).then(
        (page) => page.results,
      ),
    retry: false,
  });
}

export function useCatalogue(kind?: string) {
  return useQuery({
    queryKey: ["diagnostics", "catalogue", kind ?? "all"],
    queryFn: () =>
      unwrap(
        api.GET("/api/diagnostics/investigations/", {
          params: { query: { kind: kind && kind !== "all" ? kind : undefined } },
        }),
      ).then((page) => page.results),
    retry: false,
  });
}

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["diagnostics"] });
}

const quiet = { quietErrors: true } as const;

export function usePlaceOrder() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["PlaceDiagnosticOrderRequest"]) =>
      unwrap(api.POST("/api/diagnostics/orders/", { body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useCollect() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/diagnostics/orders/{id}/collect/", { params: { path: { id } } })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useCancelOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST("/api/diagnostics/orders/{id}/cancel/", {
          params: { path: { id } },
          body: { reason },
        }),
      ),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useRecordResult() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["RecordResultRequest"]) =>
      unwrap(api.POST("/api/diagnostics/results/", { body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useCorrectResult(resultId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["CorrectResultRequest"]) =>
      unwrap(
        api.POST("/api/diagnostics/results/{id}/correct/", {
          params: { path: { id: resultId } },
          body,
        }),
      ),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useReview() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (resultId: string) =>
      unwrap(
        api.POST("/api/diagnostics/results/{id}/review/", { params: { path: { id: resultId } } }),
      ),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useSaveInvestigation(id?: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["InvestigationRequest"]) =>
      id
        ? unwrap(
            api.PATCH("/api/diagnostics/investigations/{id}/", { params: { path: { id } }, body }),
          )
        : unwrap(api.POST("/api/diagnostics/investigations/", { body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

/** What a person can do with an order, from its state and their roles. The server decides. */
export function orderActions(order: DiagnosticOrder, roles: readonly string[]) {
  const doctor = roles.includes("doctor");
  const tech = roles.includes("lab_technician");
  const result = order.current_result;
  return {
    collect: tech && order.status === "ordered",
    record: tech && (order.status === "ordered" || order.status === "collected"),
    cancel: (doctor || tech) && (order.status === "ordered" || order.status === "collected"),
    correct: tech && order.status === "resulted" && result !== null,
    review: doctor && order.status === "resulted" && result !== null && !result.is_reviewed,
  };
}
