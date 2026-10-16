"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Dialog, Field, Notice, ReasonDialog } from "@/components/ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";

import { RowAction, Show } from "./common";

type VitalSigns = Schemas["VitalSigns"];

/** Vital-sign sets, newest first. BMI is calculated by the server, never entered. */
export function VitalsSection({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const [sets, reload] = useLoad<VitalSigns[]>(
    () => api.GET("/api/clinical/vitals/", { params: { query: { patient: patientId } } }),
    [patientId],
  );
  const [recording, setRecording] = useState(false);
  const [erroneous, setErroneous] = useState<VitalSigns | null>(null);

  return (
    <Card
      title="Vital signs"
      actions={encounterId ? <Button onClick={() => setRecording(true)}>Record vitals</Button> : null}
    >
      <Show value={sets}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-slate-600">No vital signs recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Vital signs, most recent first</caption>
                <thead className="text-slate-700">
                  <tr>
                    <th scope="col" className="p-2">Recorded</th>
                    <th scope="col" className="p-2">Readings</th>
                    <th scope="col" className="p-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((set) => (
                    <tr key={set.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap p-2">{formatDateTime(set.recorded_at)}</td>
                      <td className="p-2">
                        <ul className="flex flex-wrap gap-x-4 gap-y-1">
                          {set.observations.map((o) => (
                            <li key={o.code}>
                              <span className="text-slate-600">{o.display}:</span>{" "}
                              <span className="font-medium">
                                {Number(o.value).toString()} {o.unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="p-2 text-right">
                        <RowAction onClick={() => setErroneous(set)}>Entered in error</RowAction>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Show>
      {encounterId && (
        <RecordVitalsDialog
          open={recording}
          encounterId={encounterId}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            reload();
          }}
        />
      )}
      <ReasonDialog
        open={erroneous !== null}
        title="Mark vital signs as entered in error"
        explanation="The readings leave the chart but stay in the record's history."
        confirmLabel="Mark as entered in error"
        onClose={() => setErroneous(null)}
        onConfirm={async (reason) => {
          const { error } = await api.POST("/api/clinical/vitals/{id}/entered-in-error/", {
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

function RecordVitalsDialog({
  open,
  encounterId,
  onClose,
  onSaved,
}: {
  open: boolean;
  encounterId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [codes, setCodes] = useState<Schemas["LoincCode"][]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return setValues({});
    api.GET("/api/clinical/codes/loinc/").then(({ data }) => setCodes((data ?? []).filter((c) => !c.derived)));
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const readings = Object.entries(values)
      .filter(([, value]) => value.trim() !== "")
      .map(([code, value]) => ({ code, value: value.trim() }));
    const { error } = await api.POST("/api/clinical/vitals/", {
      body: { encounter: encounterId, readings },
    });
    if (error) {
      const problem = apiError(error);
      const detail = problem.details.readings;
      return setErrors(Array.isArray(detail) ? detail.map(String) : [problem.message]);
    }
    setErrors([]);
    onSaved();
  }

  return (
    <Dialog open={open} title="Record vital signs" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {errors.length > 0 && (
          <Notice tone="error" title="Some readings were not accepted">
            <ul className="list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
        <p className="text-sm text-slate-700">Fill in what was measured. BMI is calculated from weight and height.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {codes.map((code) => (
            <Field
              key={code.code}
              label={`${code.display} (${code.unit})`}
              inputMode="decimal"
              value={values[code.code] ?? ""}
              onChange={(e) => setValues({ ...values, [code.code]: e.target.value })}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!Object.values(values).some((v) => v.trim())}>
            Save readings
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
