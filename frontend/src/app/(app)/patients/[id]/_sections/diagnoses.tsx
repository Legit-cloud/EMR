"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Dialog, Field, Notice, ReasonDialog, Select, TextArea } from "@/components/ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDate, humanise, lagosToday } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";

import { RowAction, Show } from "./common";

type Diagnosis = Schemas["Diagnosis"];
type Patch = Schemas["PatchedDiagnosisRequest"];

const CURRENT = new Set(["active", "recurrence"]);

/**
 * Diagnoses: the problem list (current, not refuted) and past diagnoses. Status changes
 * follow the server's transition rules; the buttons only offer the usual next steps.
 */
export function DiagnosesSection({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const [rows, reload] = useLoad<Diagnosis[]>(
    () => api.GET("/api/clinical/diagnoses/", { params: { query: { patient: patientId } } }),
    [patientId],
  );
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState<Diagnosis | null>(null);
  const [erroneous, setErroneous] = useState<Diagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(diagnosis: Diagnosis, body: Patch) {
    const { error: failure } = await api.PATCH("/api/clinical/diagnoses/{id}/", {
      params: { path: { id: diagnosis.id } },
      body,
    });
    if (failure) {
      const problem = apiError(failure);
      const field = Object.values(problem.details)[0];
      setError(Array.isArray(field) ? String(field[0]) : problem.message);
      return false;
    }
    setError(null);
    await reload();
    return true;
  }

  const isCurrent = (d: Diagnosis) => CURRENT.has(d.clinical_status ?? "active") && d.verification_status !== "refuted";

  return (
    <Card title="Problem list" actions={encounterId ? <Button onClick={() => setAdding(true)}>Add diagnosis</Button> : null}>
      {error && <Notice tone="error" title={error} />}
      <Show value={rows}>
        {(all) => {
          const current = all.filter(isCurrent);
          const past = all.filter((d) => !isCurrent(d));
          return (
            <div className="flex flex-col gap-3">
              {current.length === 0 && <p className="text-slate-600">No current diagnoses.</p>}
              <DiagnosisList rows={current} onPatch={patch} onResolve={setResolving} onErroneous={setErroneous} />
              {past.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">Past and refuted ({past.length})</summary>
                  <DiagnosisList rows={past} onPatch={patch} onResolve={setResolving} onErroneous={setErroneous} />
                </details>
              )}
            </div>
          );
        }}
      </Show>
      {encounterId && (
        <AddDiagnosisDialog
          open={adding}
          encounterId={encounterId}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      <ResolveDialog
        diagnosis={resolving}
        onClose={() => setResolving(null)}
        onResolve={async (date) => {
          if (resolving && (await patch(resolving, { clinical_status: "resolved", abatement_date: date }))) setResolving(null);
        }}
      />
      <ReasonDialog
        open={erroneous !== null}
        title="Mark diagnosis as entered in error"
        explanation="The diagnosis leaves the chart but stays in the record's history."
        confirmLabel="Mark as entered in error"
        onClose={() => setErroneous(null)}
        onConfirm={async (reason) => {
          const { error: failure } = await api.POST("/api/clinical/diagnoses/{id}/entered-in-error/", {
            params: { path: { id: erroneous!.id } },
            body: { reason },
          });
          if (failure) return apiError(failure).message;
          setErroneous(null);
          reload();
          return null;
        }}
      />
    </Card>
  );
}

function DiagnosisList({
  rows,
  onPatch,
  onResolve,
  onErroneous,
}: {
  rows: Diagnosis[];
  onPatch: (d: Diagnosis, body: Patch) => Promise<boolean>;
  onResolve: (d: Diagnosis) => void;
  onErroneous: (d: Diagnosis) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {rows.map((d) => {
        const clinical = d.clinical_status ?? "active";
        const verification = d.verification_status ?? "unconfirmed";
        return (
          <li key={d.id} data-testid="diagnosis" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-mono text-sm">{d.code}</span>
            <span className="font-medium">{d.display}</span>
            <span className="text-sm text-slate-600">
              {humanise(clinical)}, {humanise(verification)}
              {d.abatement_date ? `, abated ${formatDate(d.abatement_date)}` : ""}
            </span>
            <span className="ml-auto flex flex-wrap gap-1">
              {verification === "unconfirmed" && <RowAction onClick={() => onPatch(d, { verification_status: "confirmed" })}>Confirm</RowAction>}
              {verification !== "refuted" && <RowAction onClick={() => onPatch(d, { verification_status: "refuted" })}>Refute</RowAction>}
              {CURRENT.has(clinical) && <RowAction onClick={() => onResolve(d)}>Resolve</RowAction>}
              {!CURRENT.has(clinical) && (
                <RowAction onClick={() => onPatch(d, { clinical_status: "recurrence", abatement_date: null })}>Recurrence</RowAction>
              )}
              <RowAction onClick={() => onErroneous(d)}>Entered in error</RowAction>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ResolveDialog({
  diagnosis,
  onClose,
  onResolve,
}: {
  diagnosis: Diagnosis | null;
  onClose: () => void;
  onResolve: (date: string) => void;
}) {
  const [date, setDate] = useState(lagosToday());
  return (
    <Dialog open={diagnosis !== null} title={`Resolve ${diagnosis?.display ?? ""}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onResolve(date);
        }}
      >
        <Field label="Date the condition resolved" type="date" required value={date} max={lagosToday()} onChange={(e) => setDate(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Resolve</Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddDiagnosisDialog({
  open,
  encounterId,
  onClose,
  onAdded,
}: {
  open: boolean;
  encounterId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Schemas["Icd10Code"][]>([]);
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState("unconfirmed");
  const [onset, setOnset] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCode("");
      setOnset("");
      setNote("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) return setMatches([]);
    const timer = setTimeout(async () => {
      const { data } = await api.GET("/api/clinical/codes/icd10/", { params: { query: { q: query } } });
      setMatches(data?.results ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { error: failure } = await api.POST("/api/clinical/diagnoses/", {
      body: {
        encounter: encounterId,
        code_system: "icd10",
        code,
        verification_status: verification as Schemas["VerificationStatusEnum"],
        onset_date: onset || null,
        note,
      },
    });
    if (failure) return setError(apiError(failure).message);
    onAdded();
  }

  return (
    <Dialog open={open} title="Add diagnosis" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <Field label="Search ICD-10 (code or words)" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {matches.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium">Choose the code</legend>
            <div className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {matches.map((m) => (
                <label key={m.code} className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-slate-50">
                  <input type="radio" name="icd10" value={m.code} checked={code === m.code} onChange={() => setCode(m.code)} />
                  <span className="font-mono text-sm">{m.code}</span> {m.display}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Select label="Verification" value={verification} onChange={(e) => setVerification(e.target.value)}>
          <option value="unconfirmed">Unconfirmed / suspected</option>
          <option value="confirmed">Confirmed</option>
        </Select>
        <Field label="Onset date" type="date" value={onset} max={lagosToday()} onChange={(e) => setOnset(e.target.value)} hint="Optional" />
        <TextArea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!code}>
            Add diagnosis
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
