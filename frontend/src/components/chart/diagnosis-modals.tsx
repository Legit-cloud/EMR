"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, apiError, fieldErrors, type Schemas, unwrap } from "@/lib/api";
import { useRefreshChart } from "@/lib/chart-queries";
import { lagosToday } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";

type Diagnosis = Schemas["Diagnosis"];
type ClinicalStatus = Schemas["ClinicalStatusEnum"];
type Verification = Schemas["VerificationStatusEnum"];

export const CLINICAL_OPTIONS: { value: ClinicalStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "recurrence", label: "Recurrence" },
  { value: "remission", label: "Remission" },
  { value: "resolved", label: "Resolved" },
  { value: "inactive", label: "Inactive" },
];

export const VERIFICATION_OPTIONS: { value: Verification; label: string }[] = [
  { value: "unconfirmed", label: "Unconfirmed (suspected)" },
  { value: "confirmed", label: "Confirmed" },
  { value: "refuted", label: "Refuted" },
];

/** A resolved diagnosis needs the date it resolved (CLAUDE.md Section 5). */
export function abatementError(status: ClinicalStatus, date: string): string | undefined {
  if (status !== "resolved") return undefined;
  if (!date) return "Give the date the condition resolved.";
  if (date > lagosToday()) return "The date cannot be in the future.";
  return undefined;
}

/** The first server message for a diagnosis, whichever field it names. */
function firstMessage(failure: unknown): string {
  const problem = apiError(failure);
  const field = Object.values(fieldErrors(problem))[0];
  return field ?? problem.message;
}

type Shared = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
};

const ADD_FORM = "add-diagnosis-form";

/** Add a diagnosis to the open visit, coded from an ICD-10 search. */
export function AddDiagnosisModal({
  open,
  onOpenChange,
  patientId,
  encounterId,
}: Shared & { encounterId: string }) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const [search, setSearch] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Schemas["Icd10Code"] | null>(null);
  const [clinical, setClinical] = useState<ClinicalStatus>("active");
  const [verification, setVerification] = useState<Verification>("unconfirmed");
  const [onset, setOnset] = useState("");
  const [abatement, setAbatement] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const term = useDebounced(search.trim(), 250);
  const results = useQuery({
    queryKey: ["icd10", term],
    queryFn: () =>
      unwrap(api.GET("/api/clinical/codes/icd10/", { params: { query: { q: term } } })),
    enabled: open,
    staleTime: 60_000,
  });
  const options = [
    ...(chosen ? [chosen] : []),
    ...(results.data?.results ?? []).filter((r) => r.code !== chosen?.code),
  ].map((r) => ({ value: r.code, label: `${r.code} ${r.display}` }));

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/clinical/diagnoses/", {
          body: {
            encounter: encounterId,
            code_system: "icd10",
            code: code!,
            clinical_status: clinical,
            verification_status: verification,
            onset_date: onset || null,
            abatement_date: clinical === "resolved" ? abatement : null,
            note,
          },
        }),
      ),
    meta: { quietErrors: true },
  });

  function close(next: boolean) {
    if (!next) {
      setSearch("");
      setCode(null);
      setChosen(null);
      setClinical("active");
      setVerification("unconfirmed");
      setOnset("");
      setAbatement("");
      setNote("");
      setSubmitted(false);
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!code || abatementError(clinical, abatement)) return;
    try {
      await save.mutateAsync();
    } catch (failure) {
      return setError(firstMessage(failure));
    }
    toast({ title: "Diagnosis added", tone: "success" });
    await refresh();
    close(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Add diagnosis"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={ADD_FORM} loading={save.isPending}>
              Add diagnosis
            </Button>
          }
        />
      }
    >
      <form id={ADD_FORM} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error && <Banner tone="danger" live title={error} />}
        <Combobox
          label="Search ICD-10 (code or words)"
          placeholder="For example malaria or B54"
          options={options}
          value={code}
          onValueChange={(value) => {
            setCode(value);
            setChosen(
              value ? (results.data?.results.find((r) => r.code === value) ?? chosen) : null,
            );
          }}
          onQueryChange={setSearch}
          searching={results.isFetching}
          emptyText="No matching codes"
          error={submitted && !code ? "Choose a diagnosis code." : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Clinical status"
            value={clinical}
            onValueChange={(v) => setClinical(v as ClinicalStatus)}
            options={CLINICAL_OPTIONS}
          />
          <Select
            label="Verification"
            value={verification}
            onValueChange={(v) => setVerification(v as Verification)}
            options={VERIFICATION_OPTIONS.filter((o) => o.value !== "refuted")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Onset date"
            optional
            type="date"
            max={lagosToday()}
            value={onset}
            onChange={(e) => setOnset(e.target.value)}
          />
          {clinical === "resolved" && (
            <Input
              label="Date resolved"
              type="date"
              max={lagosToday()}
              value={abatement}
              onChange={(e) => setAbatement(e.target.value)}
              error={submitted ? abatementError(clinical, abatement) : undefined}
            />
          )}
        </div>
        <Textarea
          label="Note"
          optional
          rows={2}
          maxLength={500}
          showCount
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Modal>
  );
}

const STATUS_FORM = "diagnosis-status-form";

/**
 * Change a diagnosis's clinical and verification status. The server enforces which changes
 * are allowed and says why when one is refused.
 */
export function DiagnosisStatusModal({
  diagnosis,
  onOpenChange,
  patientId,
}: {
  diagnosis: Diagnosis | null;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  // A new form for each diagnosis, so it starts from that diagnosis's own statuses.
  return (
    <StatusForm
      key={diagnosis?.id ?? "none"}
      diagnosis={diagnosis}
      onOpenChange={onOpenChange}
      patientId={patientId}
    />
  );
}

function StatusForm({
  diagnosis,
  onOpenChange,
  patientId,
}: {
  diagnosis: Diagnosis | null;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const [clinical, setClinical] = useState<ClinicalStatus>(diagnosis?.clinical_status ?? "active");
  const [verification, setVerification] = useState<Verification>(
    diagnosis?.verification_status ?? "unconfirmed",
  );
  const [abatement, setAbatement] = useState(diagnosis?.abatement_date ?? lagosToday());
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/clinical/diagnoses/{id}/", {
          params: { path: { id: diagnosis!.id } },
          body: {
            clinical_status: clinical,
            verification_status: verification,
            abatement_date: clinical === "resolved" ? abatement : null,
          },
        }),
      ),
    meta: { quietErrors: true },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (abatementError(clinical, abatement)) return;
    try {
      await save.mutateAsync();
    } catch (failure) {
      return setError(firstMessage(failure));
    }
    toast({ title: "Diagnosis updated", tone: "success" });
    await refresh();
    onOpenChange(false);
  }

  return (
    <Modal
      open={diagnosis !== null}
      onOpenChange={onOpenChange}
      size="confirm"
      title={`Update ${diagnosis?.display ?? "diagnosis"}`}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={STATUS_FORM} loading={save.isPending}>
              Save status
            </Button>
          }
        />
      }
    >
      <form id={STATUS_FORM} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error && <Banner tone="danger" live title={error} />}
        <Select
          label="Clinical status"
          value={clinical}
          onValueChange={(v) => setClinical(v as ClinicalStatus)}
          options={CLINICAL_OPTIONS}
        />
        <Select
          label="Verification"
          value={verification}
          onValueChange={(v) => setVerification(v as Verification)}
          options={VERIFICATION_OPTIONS}
        />
        {clinical === "resolved" && (
          <Input
            label="Date resolved"
            type="date"
            max={lagosToday()}
            value={abatement}
            onChange={(e) => setAbatement(e.target.value)}
            error={submitted ? abatementError(clinical, abatement) : undefined}
          />
        )}
      </form>
    </Modal>
  );
}
