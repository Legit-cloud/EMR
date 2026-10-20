"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./api";

/** Every query on a patient's chart sits under ["chart", patientId], so one call refreshes it. */
export const chartKey = (patientId: string, part: string) => ["chart", patientId, part] as const;

export function useRefreshChart(patientId: string) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["chart", patientId] });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: chartKey(id, "patient"),
    enabled: id !== "",
    queryFn: () => unwrap(api.GET("/api/patients/patients/{id}/", { params: { path: { id } } })),
  });
}

export function useAllergies(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "allergies"),
    enabled: patient !== "",
    queryFn: () => unwrap(api.GET("/api/patients/allergies/", { params: { query: { patient } } })),
  });
}

export function useEncounters(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "encounters"),
    queryFn: () => unwrap(api.GET("/api/clinical/encounters/", { params: { query: { patient } } })),
  });
}

export function useVitals(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "vitals"),
    queryFn: () => unwrap(api.GET("/api/clinical/vitals/", { params: { query: { patient } } })),
  });
}

export function useDiagnoses(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "diagnoses"),
    queryFn: () => unwrap(api.GET("/api/clinical/diagnoses/", { params: { query: { patient } } })),
  });
}

export function useNotes(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "notes"),
    queryFn: () => unwrap(api.GET("/api/clinical/notes/", { params: { query: { patient } } })),
  });
}

export function usePrescriptions(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "prescriptions"),
    queryFn: () =>
      unwrap(api.GET("/api/pharmacy/prescriptions/", { params: { query: { patient } } })),
  });
}

export function useInvoices(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "invoices"),
    enabled: patient !== "",
    queryFn: () => unwrap(api.GET("/api/billing/invoices/", { params: { query: { patient } } })),
  });
}

export function useAttachments(patient: string) {
  return useQuery({
    queryKey: chartKey(patient, "attachments"),
    queryFn: () =>
      unwrap(api.GET("/api/patients/attachments/", { params: { query: { patient } } })),
  });
}

/** Who has read or changed the patient record, for the roles allowed to see the audit log. */
export function useRecordAudit(patient: string, enabled: boolean) {
  return useQuery({
    queryKey: chartKey(patient, "audit"),
    enabled,
    queryFn: () =>
      unwrap(
        api.GET("/api/audit/entries/", {
          params: { query: { resource: "patients.patient", object_id: patient } },
        }),
      ),
  });
}

/** The visit in progress, if any. `undefined` until encounters have loaded. */
export function useOpenEncounter(patient: string) {
  const encounters = useEncounters(patient);
  const loaded = encounters.data !== undefined;
  return {
    loaded,
    encounter: encounters.data?.results.find((e) => e.status === "in_progress"),
  };
}

/**
 * What has been recorded for one visit, for the appointment drawer's Finish rule. Each count is
 * undefined while loading or when the viewer's role may not read it.
 */
export function useVisitRecords(encounterId: string | null | undefined) {
  const enabled = !!encounterId;
  const key = (part: string) => ["visit-records", encounterId, part] as const;
  const vitals = useQuery({
    queryKey: key("vitals"),
    enabled,
    retry: false,
    queryFn: () =>
      unwrap(api.GET("/api/clinical/vitals/", { params: { query: { encounter: encounterId! } } })),
  });
  const notes = useQuery({
    queryKey: key("notes"),
    enabled,
    retry: false,
    queryFn: () =>
      unwrap(api.GET("/api/clinical/notes/", { params: { query: { encounter: encounterId! } } })),
  });
  const diagnoses = useQuery({
    queryKey: key("diagnoses"),
    enabled,
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET("/api/clinical/diagnoses/", { params: { query: { encounter: encounterId! } } }),
      ),
  });
  const loaded = vitals.data && notes.data && diagnoses.data;
  return {
    /** True when all three could be read. */
    known: !!loaded,
    vitals: vitals.data?.count ?? 0,
    notes: notes.data?.count ?? 0,
    diagnoses: diagnoses.data?.count ?? 0,
    loading: enabled && (vitals.isPending || notes.isPending || diagnoses.isPending),
  };
}
