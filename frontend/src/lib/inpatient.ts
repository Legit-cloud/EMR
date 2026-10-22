import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";

/**
 * Inpatient wards and beds, from apps/inpatient (docs/adr/0021). Admitting a patient to a bed
 * makes the bed Occupied in the same transaction, and a discharge ends as Discharged, LAMA
 * (left against medical advice) or Transferred.
 */
export type Occupant = Schemas["Occupant"];
export type DischargeStatus = Schemas["DischargeStatusEnum"];
export type BedState = Schemas["BedStatusEnum"];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** The board's bed. Mutable so the test mock can move patients between beds. */
export type Bed = Mutable<Schemas["BoardBed"]>;
export type Ward = Omit<Schemas["BoardWard"], "beds"> & { beds: Bed[] };

export const DISCHARGE_STATUS: Record<DischargeStatus, { label: string; hint: string }> = {
  discharged: { label: "Discharged", hint: "Medically fit to go home." },
  lama: { label: "Left against medical advice", hint: "The patient chose to leave." },
  transferred: { label: "Transferred", hint: "Moved to another facility." },
};

export type AdmitBody = Schemas["AdmitRequest"];
export type DischargeBody = { status: DischargeStatus; note: string };

// -- numbers the board shows -------------------------------------------------------------------

export type BedCounts = Record<BedState, number> & { total: number };

export function countBeds(wards: readonly Ward[]): BedCounts {
  const counts: BedCounts = { vacant: 0, occupied: 0, cleaning: 0, out_of_service: 0, total: 0 };
  for (const ward of wards) {
    for (const bed of ward.beds) {
      counts[bed.status] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

/** "Day 3": the admission day is day 1. Whole days in Lagos time are close enough for a board. */
export function stayDay(admittedAt: string, now: Date = new Date()): number {
  const days = Math.floor((now.getTime() - Date.parse(admittedAt)) / 86_400_000);
  return Math.max(days, 0) + 1;
}

/** Beds a patient can be moved to: vacant ones, anywhere, except the bed they are in. */
export function transferTargets(wards: readonly Ward[], from: string) {
  return wards.flatMap((ward) =>
    ward.beds
      .filter((bed) => bed.status === "vacant" && bed.id !== from)
      .map((bed) => ({ value: bed.id, label: `${ward.name}, ${bed.label}` })),
  );
}

/** A discharge that is not a plain one needs a sentence saying why or where to. */
export function dischargeNoteError(status: DischargeStatus, note: string): string | null {
  if (status === "discharged") return null;
  if (note.trim().length >= 5) return null;
  return status === "lama"
    ? "Note what the patient was told about leaving."
    : "Say where the patient is being transferred to.";
}

// -- queries -----------------------------------------------------------------------------------

export function useWards() {
  return useQuery({
    queryKey: ["inpatient", "wards"],
    queryFn: async () => (await unwrap(api.GET("/api/inpatient/wards/"))) as Ward[],
    retry: false,
  });
}

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["inpatient"] });
}

export function useAdmit() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: AdmitBody) => unwrap(api.POST("/api/inpatient/admissions/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useTransfer(admission: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { bed: string; reason: string }) =>
      unwrap(
        api.POST("/api/inpatient/admissions/{id}/transfer/", {
          params: { path: { id: admission } },
          body,
        }),
      ),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useDischarge(admission: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: DischargeBody) =>
      unwrap(
        api.POST("/api/inpatient/admissions/{id}/discharge/", {
          params: { path: { id: admission } },
          body,
        }),
      ),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useMarkReady() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (bed: string) =>
      unwrap(api.POST("/api/inpatient/beds/{id}/ready/", { params: { path: { id: bed } } })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** A sentence for why the server refused an inpatient action. */
export function refusalMessage(failure: unknown): string {
  return apiError(failure).message;
}
