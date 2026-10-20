"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PatientAccessNotice } from "@/components/auth/break-glass";
import { NoAccess } from "@/components/auth/no-access";
import { DiagnosesTab } from "@/components/chart/diagnoses-tab";
import { AddDiagnosisModal } from "@/components/chart/diagnosis-modals";
import { type NoteEditing, NotesTab } from "@/components/chart/notes-tab";
import { Overview } from "@/components/chart/overview";
import { PatientBanner } from "@/components/chart/patient-banner";
import { QuickActions } from "@/components/chart/quick-actions";
import {
  AuditTab,
  BillingTab,
  DocumentsTab,
  PrescriptionsTab,
} from "@/components/chart/record-tabs";
import { RecordVitalsModal } from "@/components/chart/record-vitals-modal";
import { VitalsTab } from "@/components/chart/vitals-tab";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { ApiRequestError } from "@/lib/api";
import { useAllergies, useOpenEncounter, usePatient } from "@/lib/chart-queries";
import { ageFrom } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useUndoable } from "@/lib/use-undoable";

const TABS = [
  "overview",
  "vitals",
  "diagnoses",
  "notes",
  "prescriptions",
  "billing",
  "documents",
  "audit",
];

/**
 * The patient chart (docs/DESIGN.md Section 8). Every section loads its own data and shows
 * "no access" when the API refuses it, so each role sees what it may and nothing is hidden by
 * the client. Orders and Results are not here yet: they arrive with diagnostics in Release 2.
 */
export function PatientChart({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const permissions = usePermissions();
  const patient = usePatient(id);
  const allergies = useAllergies(id);
  const { encounter } = useOpenEncounter(id);
  const undo = useUndoable();

  const [recordingVitals, setRecordingVitals] = useState(false);
  const [addingDiagnosis, setAddingDiagnosis] = useState(false);
  const [noteEditing, setNoteEditing] = useState<NoteEditing | null>(null);

  // The tab lives in state so it changes at once; the address is updated so it can be shared.
  const [requested, setRequested] = useState(search.get("tab") ?? "overview");
  const canAudit = permissions.hasRole("compliance_officer", "tenant_admin");
  const tab =
    TABS.includes(requested) && (requested !== "audit" || canAudit) ? requested : "overview";

  function openTab(next: string) {
    setRequested(next);
    const query = new URLSearchParams(search.toString());
    if (next === "overview") query.delete("tab");
    else query.set("tab", next);
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname);
  }

  if (patient.error instanceof ApiRequestError) {
    if (patient.error.status === 403) return <NoAccess what="this patient's record" asPage />;
    if (patient.error.status === 404) {
      return <EmptyState title="This patient could not be found." />;
    }
  }
  if (!patient.data) {
    return (
      <Loading label="Loading the chart">
        <div className="flex flex-col gap-4">
          <Skeleton className="rounded-card h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="rounded-card h-64 w-full" />
        </div>
      </Loading>
    );
  }

  const ageYears = ageFrom(patient.data.date_of_birth);
  // Visit tools are for the roles that work a visit; the API still decides who may do what.
  const canWork = permissions.hasRole("doctor", "nurse");
  const { hidden, schedule } = undo;

  function startNote() {
    if (!encounter) return;
    setNoteEditing({ mode: "new", encounter: encounter.id });
    openTab("notes");
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PatientBanner
        patient={patient.data}
        allergies={allergies.data?.results.filter((a) => !hidden.has(a.id))}
        notice={<PatientAccessNotice patientId={id} />}
      />
      <Tabs
        label="Patient chart"
        value={tab}
        onValueChange={openTab}
        items={[
          {
            value: "overview",
            label: "Overview",
            content: (
              <Overview
                patientId={id}
                ageYears={ageYears}
                hidden={hidden}
                schedule={schedule}
                canWork={canWork}
                onOpenTab={openTab}
              />
            ),
          },
          {
            value: "vitals",
            label: "Vitals",
            content: (
              <VitalsTab
                patientId={id}
                ageYears={ageYears}
                canRecord={canWork && !!encounter}
                onRecord={() => setRecordingVitals(true)}
                hidden={hidden}
                schedule={schedule}
              />
            ),
          },
          {
            value: "diagnoses",
            label: "Diagnoses",
            content: (
              <DiagnosesTab
                patientId={id}
                canAdd={canWork && !!encounter}
                onAdd={() => setAddingDiagnosis(true)}
                hidden={hidden}
                schedule={schedule}
              />
            ),
          },
          {
            value: "notes",
            label: "Notes",
            content: (
              <NotesTab
                patientId={id}
                encounterId={canWork ? encounter?.id : undefined}
                editing={noteEditing}
                onEdit={setNoteEditing}
                hidden={hidden}
                schedule={schedule}
              />
            ),
          },
          {
            value: "prescriptions",
            label: "Prescriptions",
            content: (
              <PrescriptionsTab
                patientId={id}
                openEncounterId={permissions.hasRole("doctor") ? encounter?.id : undefined}
              />
            ),
          },
          { value: "billing", label: "Billing", content: <BillingTab patientId={id} /> },
          { value: "documents", label: "Documents", content: <DocumentsTab patientId={id} /> },
          ...(canAudit
            ? [
                {
                  value: "audit",
                  label: "Audit",
                  content: <AuditTab patientId={id} enabled={canAudit} />,
                },
              ]
            : []),
        ]}
      />

      {canWork && encounter && (
        <>
          <QuickActions
            encounterId={encounter.id}
            canPrescribe={permissions.hasRole("doctor")}
            onRecordVitals={() => setRecordingVitals(true)}
            onAddDiagnosis={() => setAddingDiagnosis(true)}
            onWriteNote={startNote}
          />
          <RecordVitalsModal
            open={recordingVitals}
            onOpenChange={setRecordingVitals}
            patientId={id}
            encounterId={encounter.id}
          />
          <AddDiagnosisModal
            open={addingDiagnosis}
            onOpenChange={setAddingDiagnosis}
            patientId={id}
            encounterId={encounter.id}
          />
        </>
      )}
    </div>
  );
}
