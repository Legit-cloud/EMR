"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  Button,
  Dialog,
  Field,
  Loading,
  LoadFailed,
  NoAccess,
  Notice,
} from "@/components/legacy-ui";
import { PatientName } from "@/components/PatientName";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/format";

type Prescription = Schemas["Prescription"];

/** Pharmacy worklist: signed prescriptions waiting to be dispensed. */
export default function PharmacyPage() {
  const [worklist, setWorklist] = useState<Prescription[] | "forbidden" | "error" | null>(null);
  const [dispensing, setDispensing] = useState<Prescription | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [authorised, partial] = await Promise.all([
      api.GET("/api/pharmacy/prescriptions/", { params: { query: { status: "authorised" } } }),
      api.GET("/api/pharmacy/prescriptions/", {
        params: { query: { status: "partially_dispensed" } },
      }),
    ]);
    if (authorised.response.status === 403) return setWorklist("forbidden");
    if (!authorised.response.ok || !partial.response.ok) return setWorklist("error");
    setWorklist([...(authorised.data?.results ?? []), ...(partial.data?.results ?? [])]);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pharmacy</h1>
        <Link href="/pharmacy/formulary" className="text-teal-800 underline">
          Formulary and stock
        </Link>
      </div>
      <div aria-live="polite">{message && <Notice tone="success" title={message} />}</div>
      {worklist === null ? (
        <Loading />
      ) : worklist === "forbidden" ? (
        <NoAccess />
      ) : worklist === "error" ? (
        <LoadFailed what="The dispensing list" onRetry={load} />
      ) : worklist.length === 0 ? (
        <p className="text-slate-600">Nothing waiting to be dispensed.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {worklist.map((p) => (
            <li
              key={p.id}
              data-testid="to-dispense"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <PatientName id={p.patient} />
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                  {humanise(p.status)}
                </span>
                <span className="text-sm text-slate-600">
                  Signed {formatDateTime(p.authorised_at)}
                </span>
                <Button className="ml-auto" onClick={() => setDispensing(p)}>
                  Dispense
                </Button>
              </div>
              <ul className="mt-2 text-sm">
                {p.items.map((item) => (
                  <li key={item.id}>
                    {item.drug_name}: {item.dose}, {item.frequency}, {item.duration_days} days —{" "}
                    {item.quantity_dispensed} of {item.quantity} given
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <DispenseDialog
        prescription={dispensing}
        onClose={() => setDispensing(null)}
        onDone={(status) => {
          setDispensing(null);
          setMessage(`Dispensed. Prescription is now ${humanise(status).toLowerCase()}.`);
          load();
        }}
      />
    </div>
  );
}

/** Checks the signature first; dispensing is refused by the server if it does not verify. */
function DispenseDialog({
  prescription,
  onClose,
  onDone,
}: {
  prescription: Prescription | null;
  onClose: () => void;
  onDone: (status: string) => void;
}) {
  const [signature, setSignature] = useState<"checking" | "valid" | "invalid">("checking");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prescription) return;
    setError(null);
    setSignature("checking");
    setQuantities(
      Object.fromEntries(
        prescription.items.map((i) => [i.id, String(i.quantity - (i.quantity_dispensed ?? 0))]),
      ),
    );
    api
      .GET("/api/pharmacy/prescriptions/{id}/verify/", {
        params: { path: { id: prescription.id } },
      })
      .then(({ data }) => setSignature(data?.valid ? "valid" : "invalid"));
  }, [prescription]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prescription) return;
    const items = Object.fromEntries(
      Object.entries(quantities)
        .map(([id, value]) => [id, Number.parseInt(value, 10)] as const)
        .filter(([, value]) => Number.isInteger(value) && value > 0),
    );
    const { data, error: failure } = await api.POST("/api/pharmacy/prescriptions/{id}/dispense/", {
      params: { path: { id: prescription.id } },
      body: { items },
    });
    if (!data) return setError(apiError(failure).message);
    onDone(data.status);
  }

  return (
    <Dialog open={prescription !== null} title="Dispense" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {signature === "checking" && <p role="status">Checking the prescriber&apos;s signature…</p>}
        {signature === "valid" && (
          <Notice
            tone="success"
            title="Signature verified: the prescription is unchanged since signing."
          />
        )}
        {signature === "invalid" && (
          <Notice
            tone="error"
            title="The signature does not verify. Do not dispense; contact the prescriber."
          />
        )}
        {error && <Notice tone="error" title={error} />}
        {prescription?.items.map((item) => (
          <Field
            key={item.id}
            label={`${item.drug_name} (${item.quantity - (item.quantity_dispensed ?? 0)} outstanding)`}
            type="number"
            min={0}
            max={item.quantity - (item.quantity_dispensed ?? 0)}
            value={quantities[item.id] ?? ""}
            onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
          />
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={signature !== "valid"}>
            Dispense
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
