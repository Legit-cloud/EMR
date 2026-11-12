import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";

/** Claims to insurers and HMOs (docs/adr/0025). */
export type Claim = Schemas["Claim"];
export type ClaimStatus = Schemas["ClaimStatusEnum"];

export type ClaimFilters = { status: string; page: number; pageSize: number };

export function useClaims({ status, page, pageSize }: ClaimFilters) {
  return useQuery({
    queryKey: ["claims", "list", { status, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/billing/claims/", {
          params: {
            query: {
              status: status === "all" ? undefined : (status as ClaimStatus),
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

export function useAgeing() {
  return useQuery({
    queryKey: ["claims", "ageing"],
    queryFn: () => unwrap(api.GET("/api/billing/claims/ageing/")),
    retry: false,
  });
}

function useRefresh() {
  const client = useQueryClient();
  return () => {
    // Paying a claim also changes the invoice it belongs to.
    client.invalidateQueries({ queryKey: ["claims"] });
    client.invalidateQueries({ queryKey: ["billing"] });
  };
}

const quiet = { quietErrors: true } as const;

export function useCreateClaim() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (invoice: string) =>
      unwrap(api.POST("/api/billing/claims/", { body: { invoice } })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useSubmitClaim(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (insurerReference: string) =>
      unwrap(
        api.POST("/api/billing/claims/{id}/submit/", {
          params: { path: { id } },
          body: { insurer_reference: insurerReference },
        }),
      ),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useApproveClaim(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["ApproveClaimRequest"]) =>
      unwrap(api.POST("/api/billing/claims/{id}/approve/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useRejectClaim(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST("/api/billing/claims/{id}/reject/", {
          params: { path: { id } },
          body: { reason },
        }),
      ),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useSettleClaim(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["SettleClaimRequest"]) =>
      unwrap(api.POST("/api/billing/claims/{id}/settle/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

/** What can be done next with a claim; the server decides. */
export function claimAction(
  claim: Pick<Claim, "status">,
): "send" | "answer" | "pay" | "resend" | null {
  switch (claim.status) {
    case "draft":
      return "send";
    case "submitted":
      return "answer";
    case "approved":
      return "pay";
    case "rejected":
      return "resend";
    default:
      return null;
  }
}
