import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";

/**
 * The patient portal, from apps/portal (docs/adr/0022). Every call is for the signed-in patient
 * and nobody else: the server takes the patient from the session, and there is no patient id
 * anywhere in these requests.
 */
export type PortalAppointment = Schemas["PortalAppointment"];
export type PortalSlot = Schemas["PortalSlot"];
export type PortalResult = Schemas["PortalResult"];
export type PortalPrescription = Schemas["PortalPrescription"];
export type PortalInvoice = Schemas["PortalInvoice"];
export type PortalProfile = Schemas["PortalProfile"];
export type PortalHome = Schemas["PortalHome"];
export type ConsentKey = keyof Schemas["Consents"];

export const CONSENTS: { key: ConsentKey; label: string; explain: string }[] = [
  {
    key: "email_reminders",
    label: "Email reminders",
    explain: "We email you the same reminders, with your appointment calendar file.",
  },
  {
    key: "share_in_facility",
    label: "Share my record with the clinicians treating me",
    explain:
      "Doctors and nurses involved in your care here can see your record. Turning this off may slow your care.",
  },
  {
    key: "research",
    label: "Use my details, with my name removed, to improve care",
    explain:
      "Your information is never used with your name attached. This is optional and does not change your care.",
  },
];

// -- queries -----------------------------------------------------------------------------------

export const useHome = () =>
  useQuery({
    queryKey: ["portal", "home"],
    queryFn: () => unwrap(api.GET("/api/portal/home/")),
    retry: false,
  });

export const useAppointments = () =>
  useQuery({
    queryKey: ["portal", "appointments"],
    queryFn: () => unwrap(api.GET("/api/portal/appointments/")),
    retry: false,
  });

export const useSlots = (enabled: boolean) =>
  useQuery({
    queryKey: ["portal", "slots"],
    queryFn: () => unwrap(api.GET("/api/portal/appointment-slots/")),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  });

export const useResults = () =>
  useQuery({
    queryKey: ["portal", "results"],
    queryFn: () => unwrap(api.GET("/api/portal/results/")),
    retry: false,
  });

export const usePrescriptions = () =>
  useQuery({
    queryKey: ["portal", "prescriptions"],
    queryFn: () => unwrap(api.GET("/api/portal/prescriptions/")),
    retry: false,
  });

export const useInvoices = () =>
  useQuery({
    queryKey: ["portal", "invoices"],
    queryFn: () => unwrap(api.GET("/api/portal/invoices/")),
    retry: false,
  });

export const useProfile = () =>
  useQuery({
    queryKey: ["portal", "profile"],
    queryFn: () => unwrap(api.GET("/api/portal/profile/")),
    retry: false,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["portal"] });
}

export function useBook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["BookRequest"]) =>
      unwrap(api.POST("/api/portal/appointments/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useCancel(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["PortalCancelRequest"]) =>
      unwrap(api.POST("/api/portal/appointments/{id}/cancel/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useMarkSeen() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/portal/results/{id}/seen/", { params: { path: { id } } })),
    onSettled: () => refresh(),
  });
}

export function useSaveProfile() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["PatchedProfileUpdateRequest"]) =>
      unwrap(api.PATCH("/api/portal/profile/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

// -- small rules -------------------------------------------------------------------------------

/** Results the patient has not opened yet. */
export const unseen = (results: readonly PortalResult[]) => results.filter((r) => !r.seen);
