"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Dialog, Field, Notice, ReasonDialog, Select } from "@/components/legacy-ui";
import { api, apiError, fieldErrors, type Schemas } from "@/lib/api";
import { humanise } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";

import { RowAction, Show } from "./common";

type Allergy = Schemas["Allergy"];

const SEVERITY_STYLE: Record<string, string> = {
  severe: "bg-red-100 text-red-900",
  moderate: "bg-amber-100 text-amber-900",
  mild: "bg-slate-100 text-slate-800",
};

/** Structured allergies; the prescription safety check reads these. */
export function AllergiesSection({ patientId }: { patientId: string }) {
  const [rows, reload] = useLoad<Allergy[]>(
    () => api.GET("/api/patients/allergies/", { params: { query: { patient: patientId } } }),
    [patientId],
  );
  const [adding, setAdding] = useState(false);
  const [erroneous, setErroneous] = useState<Allergy | null>(null);

  return (
    <Card
      title="Allergies"
      actions={
        rows !== "forbidden" ? <Button onClick={() => setAdding(true)}>Add allergy</Button> : null
      }
    >
      <Show value={rows}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-slate-600">No allergies recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((a) => (
                <li key={a.id} data-testid="allergy" className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.substance}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[a.severity] ?? ""}`}
                  >
                    {humanise(a.severity)}
                  </span>
                  <span className="text-sm text-slate-700">{a.reaction}</span>
                  <span className="ml-auto">
                    <RowAction onClick={() => setErroneous(a)}>Entered in error</RowAction>
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </Show>
      <AddAllergyDialog
        open={adding}
        patientId={patientId}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          reload();
        }}
      />
      <ReasonDialog
        open={erroneous !== null}
        title="Mark allergy as entered in error"
        explanation="The allergy leaves the chart and the safety check, but stays in the record's history."
        confirmLabel="Mark as entered in error"
        onClose={() => setErroneous(null)}
        onConfirm={async (reason) => {
          const { error } = await api.POST("/api/patients/allergies/{id}/entered-in-error/", {
            params: { path: { id: erroneous!.id } },
            body: { reason },
          });
          if (error) return apiError(error).message;
          setErroneous(null);
          reload();
          return null;
        }}
      />
    </Card>
  );
}

const EMPTY = { substance: "", category: "medication", reaction: "", severity: "moderate" };

function AddAllergyDialog({
  open,
  patientId,
  onClose,
  onAdded,
}: {
  open: boolean;
  patientId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setErrors({});
      setFailure(null);
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { error } = await api.POST("/api/patients/allergies/", {
      body: {
        patient: patientId,
        substance: form.substance,
        category: form.category as Schemas["AllergyCategoryEnum"],
        reaction: form.reaction,
        severity: form.severity as Schemas["AllergySeverityEnum"],
      },
    });
    if (error) {
      const problem = apiError(error);
      setErrors(fieldErrors(problem));
      return setFailure(problem.code === "validation_error" ? null : problem.message);
    }
    onAdded();
  }

  return (
    <Dialog open={open} title="Add allergy" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {failure && <Notice tone="error" title={failure} />}
        <Field
          label="Substance"
          required
          value={form.substance}
          onChange={(e) => setForm({ ...form, substance: e.target.value })}
          error={errors.substance}
          hint="For a medicine, use the ingredient or class (for example Penicillin)."
        />
        <Select
          label="Category"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        >
          <option value="medication">Medication</option>
          <option value="food">Food</option>
          <option value="environment">Environment</option>
          <option value="biologic">Biologic</option>
        </Select>
        <Field
          label="Reaction"
          required
          value={form.reaction}
          onChange={(e) => setForm({ ...form, reaction: e.target.value })}
          error={errors.reaction}
        />
        <Select
          label="Severity"
          value={form.severity}
          onChange={(e) => setForm({ ...form, severity: e.target.value })}
        >
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add allergy</Button>
        </div>
      </form>
    </Dialog>
  );
}
