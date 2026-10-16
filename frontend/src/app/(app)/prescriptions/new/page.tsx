"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button, Dialog, Field, Loading, NoAccess, Notice, Select } from "@/components/legacy-ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { humanise } from "@/lib/format";

type Item = Schemas["PrescriptionItemRequest"];
type Alert = Schemas["SafetyAlert"];

const MIN_REASON = 15;
const NEW_ITEM: Item = {
  drug: "",
  dose: "",
  frequency: "",
  route: "oral",
  duration_days: 5,
  quantity: 1,
  instructions: "",
};

export default function NewPrescriptionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PrescriptionEditor />
    </Suspense>
  );
}

/**
 * Prescribing: a draft is saved, then signed. Signing runs the server's allergy and
 * interaction check; blocking alerts open a dialog that asks for an override reason.
 */
function PrescriptionEditor() {
  const encounter = useSearchParams().get("encounter") ?? "";
  const [drugs, setDrugs] = useState<Schemas["Drug"][] | "forbidden" | null>(null);
  const [items, setItems] = useState<Item[]>([{ ...NEW_ITEM }]);
  const [prescription, setPrescription] = useState<Schemas["Prescription"] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .GET("/api/pharmacy/drugs/", { params: { query: { formulary: "true" } } })
      .then(({ data, response }) =>
        setDrugs(response.status === 403 ? "forbidden" : (data?.results ?? [])),
      );
  }, []);

  const update = (index: number, change: Partial<Item>) =>
    setItems(items.map((item, i) => (i === index ? { ...item, ...change } : item)));

  async function saveDraft(): Promise<Schemas["Prescription"] | null> {
    const body = { encounter, items };
    const { data, error: failure } = prescription
      ? await api.PATCH("/api/pharmacy/prescriptions/{id}/", {
          params: { path: { id: prescription.id } },
          body,
        })
      : await api.POST("/api/pharmacy/prescriptions/", { body });
    if (!data) {
      setError(apiError(failure).message);
      return null;
    }
    setPrescription(data);
    return data;
  }

  async function sign(overrides: Record<string, string> = {}) {
    setBusy(true);
    setError(null);
    const draft = prescription?.status === "draft" && alerts ? prescription : await saveDraft();
    if (!draft) return setBusy(false);
    const { data, error: failure } = await api.POST("/api/pharmacy/prescriptions/{id}/authorise/", {
      params: { path: { id: draft.id } },
      body: { overrides },
    });
    setBusy(false);
    if (data) {
      setPrescription(data);
      setAlerts(null);
      return;
    }
    const problem = apiError(failure);
    if (problem.code === "safety_alerts") {
      setAlerts(problem.details.alerts as Alert[]);
      return;
    }
    setError(problem.message);
  }

  if (!encounter)
    return <Notice tone="error" title="Open a patient's chart to start a prescription." />;
  if (drugs === null) return <Loading />;
  if (drugs === "forbidden") return <NoAccess />;

  if (prescription && prescription.status !== "draft") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Notice tone="success" title={`Prescription ${humanise(prescription.status)}`}>
          Signed and sent to the pharmacy. Signature key {prescription.signing_key_id}.
        </Notice>
        {prescription.alerts
          .filter((a) => a.override_reason)
          .map((a) => (
            <p key={a.key} className="text-sm text-slate-700">
              Override recorded for “{a.message}”: {a.override_reason}
            </p>
          ))}
        <Link href={`/patients/${prescription.patient}`} className="text-teal-800 underline">
          Back to the chart
        </Link>
      </div>
    );
  }

  const blocking = (alerts ?? []).filter((a) => a.blocking);
  const ready = blocking.every((a) => (reasons[a.key] ?? "").trim().length >= MIN_REASON);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">New prescription</h1>
      {error && <Notice tone="error" title={error} />}
      {items.map((item, index) => (
        <fieldset
          key={index}
          className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
        >
          <legend className="px-1 text-sm font-semibold">Item {index + 1}</legend>
          <Select
            label="Medicine"
            value={item.drug}
            onChange={(e) => update(index, { drug: e.target.value })}
            required
          >
            <option value="">Choose…</option>
            {drugs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} {d.strength} ({humanise(d.form)})
              </option>
            ))}
          </Select>
          <Field
            label="Dose"
            value={item.dose}
            onChange={(e) => update(index, { dose: e.target.value })}
            placeholder="1 tablet"
            required
          />
          <Field
            label="Frequency"
            value={item.frequency}
            onChange={(e) => update(index, { frequency: e.target.value })}
            placeholder="three times daily"
            required
          />
          <Field
            label="Duration (days)"
            type="number"
            min={1}
            value={item.duration_days}
            onChange={(e) => update(index, { duration_days: Number(e.target.value) })}
          />
          <Field
            label="Quantity to dispense"
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) => update(index, { quantity: Number(e.target.value) })}
          />
          <Field
            label="Instructions"
            value={item.instructions}
            onChange={(e) => update(index, { instructions: e.target.value })}
          />
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setItems([...items, { ...NEW_ITEM }])}>
          Add another medicine
        </Button>
        <Button
          onClick={() => sign()}
          disabled={busy || items.some((i) => !i.drug || !i.dose || !i.frequency)}
        >
          {busy ? "Checking…" : "Save and sign"}
        </Button>
      </div>

      <Dialog open={alerts !== null} title="Safety check" onClose={() => setAlerts(null)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-700">
            The prescription has not been signed. Review each alert. Alerts marked “must override”
            need a reason, which is recorded with your signature.
          </p>
          <ul className="flex flex-col gap-3">
            {(alerts ?? []).map((alert) => (
              <li
                key={alert.key}
                data-testid="safety-alert"
                className={`rounded-md border p-3 ${alert.blocking ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}
              >
                <p className="font-semibold">
                  {humanise(alert.kind)} — {humanise(alert.severity)}
                  {alert.blocking ? " (must override)" : " (warning)"}
                </p>
                <p className="text-sm">{alert.message}</p>
                {alert.blocking && (
                  <div className="mt-2">
                    <Field
                      label="Reason for overriding"
                      value={reasons[alert.key] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [alert.key]: e.target.value })}
                      hint={`At least ${MIN_REASON} characters.`}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAlerts(null)}>
              Back to the prescription
            </Button>
            <Button
              variant="danger"
              disabled={!ready || busy}
              onClick={() => sign(Object.fromEntries(blocking.map((a) => [a.key, reasons[a.key]])))}
            >
              Override and sign
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
