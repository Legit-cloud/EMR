"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, ApiRequestError, type Schemas, unwrap } from "./api";

// The API always returns the end; the schema marks it optional because booking may omit it.
export type Appointment = Schemas["Appointment"] & { end_at: string };
export type Physician = Schemas["StaffProfile"];

/** A day or week holds at most this many appointments on one page (the API's limit). */
const PAGE_SIZE = "100";

/** Everything the appointments screen loads sits under ["appointments"], so one call refreshes it. */
export function useRefreshAppointments() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["appointments"] });
}

export function usePhysicians() {
  return useQuery({
    queryKey: ["appointments", "physicians"],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/staff/profiles/", { params: { query: { staff_type: "physician" } } }),
        )
      ).results,
    staleTime: 5 * 60_000,
  });
}

type Range = { from: string; to: string; physician?: string };

export function useAppointments({ from, to, physician }: Range, enabled = true) {
  return useQuery({
    queryKey: ["appointments", "list", from, to, physician ?? "all"],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/scheduling/appointments/", {
            params: { query: { from, to, physician, page_size: PAGE_SIZE } },
          }),
        )
      ).results,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useWindows({ from, to, physician }: Range, enabled = true) {
  return useQuery({
    queryKey: ["appointments", "windows", from, to, physician ?? "all"],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/scheduling/availability/", {
            params: { query: { from, to, physician, page_size: PAGE_SIZE } },
          }),
        )
      ).results,
    enabled,
    staleTime: 5 * 60_000,
    // Availability is guidance for the hatching only: if it is refused, show no hatching.
    retry: false,
  });
}

/** History: appointments that have ended one way or another. */
export function useHistory({ from, to }: { from: string; to: string }) {
  return useQuery({
    queryKey: ["appointments", "history", from, to],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/scheduling/appointments/", {
            params: {
              query: { from, to, status: "completed,no_show,cancelled", page_size: PAGE_SIZE },
            },
          }),
        )
      ).results,
  });
}

export type MoveTarget = { start_at: string; end_at?: string; physician?: string };

export function useReschedule() {
  const refresh = useRefreshAppointments();
  return useMutation({
    mutationFn: ({ id, ...body }: MoveTarget & { id: string }) =>
      unwrap(
        api.POST("/api/scheduling/appointments/{id}/reschedule/", {
          params: { path: { id } },
          body,
        }),
      ),
    onSettled: () => refresh(),
    // Callers show a conflict next to the calendar, not as a toast.
    meta: { quietErrors: true },
  });
}

export function useChangeStatus() {
  const refresh = useRefreshAppointments();
  return useMutation({
    mutationFn: ({
      id,
      status,
      cancellation_reason,
    }: {
      id: string;
      status: Schemas["AppointmentStatusEnum"];
      cancellation_reason?: string;
    }) =>
      unwrap(
        api.POST("/api/scheduling/appointments/{id}/status/", {
          params: { path: { id } },
          body: { status, cancellation_reason: cancellation_reason ?? "" },
        }),
      ),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** A sentence for why a booking or a move was refused, for the person at the calendar. */
export function conflictMessage(failure: unknown, physician?: string): string {
  const problem = apiError(failure);
  if (problem.code === "slot_taken") {
    return `${physician ?? "The physician"} already has an appointment at that time. Choose another time.`;
  }
  const field = Object.values(problem.details).find((value) => Array.isArray(value)) as
    string[] | undefined;
  if (failure instanceof ApiRequestError && field?.length) return String(field[0]);
  return problem.message;
}

export const APPOINTMENT_TYPES: { value: Schemas["AppointmentTypeEnum"]; label: string }[] = [
  { value: "new", label: "New visit" },
  { value: "follow_up", label: "Follow-up" },
  { value: "procedure", label: "Procedure" },
  { value: "emergency", label: "Emergency" },
];

export const typeLabel = (type: Schemas["AppointmentTypeEnum"]) =>
  APPOINTMENT_TYPES.find((t) => t.value === type)?.label ?? type;

export function useFacilities(enabled = true) {
  return useQuery({
    queryKey: ["appointments", "facilities"],
    queryFn: async () => (await unwrap(api.GET("/api/tenants/facilities/"))).results,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDepartments(facility: string, enabled = true) {
  return useQuery({
    queryKey: ["appointments", "departments", facility],
    queryFn: async () =>
      (await unwrap(api.GET("/api/tenants/departments/", { params: { query: { facility } } })))
        .results,
    enabled: enabled && facility !== "",
    staleTime: 5 * 60_000,
  });
}

/** Patients matching what the clerk has typed, for choosing who to book. */
export function usePatientSearch(term: string, enabled = true) {
  return useQuery({
    queryKey: ["appointments", "patient-search", term],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/patients/patients/", { params: { query: { q: term, page_size: "10" } } }),
        )
      ).results,
    enabled: enabled && term.length >= 2,
    staleTime: 30_000,
  });
}
