import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiError } from "@/lib/api";
import { planned } from "@/lib/planned-api";
import type { BedStatus } from "@/lib/status-map";

/**
 * Inpatient wards and beds. The backend for this module is planned (Release 2), so the types
 * are written here rather than generated; they follow CLAUDE.md Section 5: admitting a patient
 * to a bed makes the bed Occupied in the same transaction, and a discharge ends as Discharged,
 * LAMA (left against medical advice) or Transferred.
 */
export type Occupant = {
  admission: string;
  patient: string;
  patient_name: string;
  patient_mrn: string;
  admitted_at: string;
  reason: string;
};

export type Bed = {
  id: string;
  label: string;
  status: BedStatus;
  occupant: Occupant | null;
};

export type Ward = { id: string; name: string; beds: Bed[] };

export type DischargeStatus = "discharged" | "lama" | "transferred";

export const DISCHARGE_STATUS: Record<DischargeStatus, { label: string; hint: string }> = {
  discharged: { label: "Discharged", hint: "Medically fit to go home." },
  lama: { label: "Left against medical advice", hint: "The patient chose to leave." },
  transferred: { label: "Transferred", hint: "Moved to another facility." },
};

export type AdmitBody = { patient: string; bed: string; reason: string };
export type DischargeBody = { status: DischargeStatus; note: string };

// -- numbers the board shows -------------------------------------------------------------------

export type BedCounts = Record<BedStatus, number> & { total: number };

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
    queryFn: () => planned.get<Ward[]>("/api/inpatient/wards/"),
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
    mutationFn: (body: AdmitBody) => planned.post<Occupant>("/api/inpatient/admissions/", body),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useTransfer(admission: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { bed: string; reason: string }) =>
      planned.post<Occupant>(`/api/inpatient/admissions/${admission}/transfer/`, body),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useDischarge(admission: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: DischargeBody) =>
      planned.post<{ status: DischargeStatus }>(
        `/api/inpatient/admissions/${admission}/discharge/`,
        body,
      ),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useMarkReady() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (bed: string) => planned.post<Bed>(`/api/inpatient/beds/${bed}/ready/`),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** A sentence for why the server refused an inpatient action. */
export function refusalMessage(failure: unknown): string {
  return apiError(failure).message;
}
