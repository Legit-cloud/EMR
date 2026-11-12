import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";

/** The sites and departments of the organisation. */
export type Facility = Schemas["Facility"];
export type Department = Schemas["Department"];

export function useFacilities() {
  return useQuery({
    queryKey: ["organisation", "facilities"],
    queryFn: () => unwrap(api.GET("/api/tenants/facilities/")).then((page) => page.results),
    retry: false,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ["organisation", "departments"],
    queryFn: () => unwrap(api.GET("/api/tenants/departments/")).then((page) => page.results),
    retry: false,
  });
}

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["organisation"] });
}

const quiet = { quietErrors: true } as const;

export function useSaveFacility(id?: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["FacilityRequest"]) =>
      id
        ? unwrap(api.PATCH("/api/tenants/facilities/{id}/", { params: { path: { id } }, body }))
        : unwrap(api.POST("/api/tenants/facilities/", { body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export function useSaveDepartment(id?: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["DepartmentRequest"]) =>
      id
        ? unwrap(api.PATCH("/api/tenants/departments/{id}/", { params: { path: { id } }, body }))
        : unwrap(api.POST("/api/tenants/departments/", { body })),
    onSettled: () => refresh(),
    meta: quiet,
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

/** A short code from a name, for the facility address: "Main Hospital" becomes "main-hospital". */
export function codeFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
