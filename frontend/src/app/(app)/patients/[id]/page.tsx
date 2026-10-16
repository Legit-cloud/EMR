"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { Card, Loading, NoAccess, Notice } from "@/components/ui";
import { api, type Schemas } from "@/lib/api";
import { ageFrom, formatDate, formatDateTime, formatMoney, humanise } from "@/lib/format";

/** A section's data: undefined while loading, "forbidden" when the API says no. */
type Loaded<T> = T | "forbidden" | undefined;

/** Load one section; list endpoints are paginated, so unwrap ``results``. */
function load<T>(promise: Promise<{ data?: unknown; response: Response }>, set: (v: Loaded<T>) => void) {
  promise.then(({ data, response }) => {
    if (response.status === 403) return set("forbidden");
    const value = data && typeof data === "object" && "results" in data ? (data as { results: T }).results : data;
    set(value as T);
  });
}

function Section<T>({ value, children }: { value: Loaded<T>; children: (v: T) => React.ReactNode }) {
  if (value === undefined) return <Loading />;
  if (value === "forbidden") return <NoAccess />;
  return <>{children(value)}</>;
}

const SEVERITY_STYLE: Record<string, string> = {
  severe: "bg-red-100 text-red-900",
  moderate: "bg-amber-100 text-amber-900",
  mild: "bg-slate-100 text-slate-800",
};

export default function PatientChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [patient, setPatient] = useState<Loaded<Schemas["Patient"]>>();
  const [allergies, setAllergies] = useState<Loaded<Schemas["Allergy"][]>>();
  const [vitals, setVitals] = useState<Loaded<Schemas["VitalSigns"][]>>();
  const [diagnoses, setDiagnoses] = useState<Loaded<Schemas["Diagnosis"][]>>();
  const [encounters, setEncounters] = useState<Loaded<Schemas["Encounter"][]>>();
  const [invoices, setInvoices] = useState<Loaded<Schemas["Invoice"][]>>();

  useEffect(() => {
    const byPatient = { params: { query: { patient: id } } };
    load(api.GET("/api/patients/patients/{id}/", { params: { path: { id } } }), setPatient);
    load(api.GET("/api/patients/allergies/", byPatient), setAllergies);
    load(api.GET("/api/clinical/vitals/", byPatient), setVitals);
    load(api.GET("/api/clinical/diagnoses/", { params: { query: { patient: id, current: "true" } } }), setDiagnoses);
    load(api.GET("/api/clinical/encounters/", byPatient), setEncounters);
    load(api.GET("/api/billing/invoices/", byPatient), setInvoices);
  }, [id]);

  const openEncounter =
    Array.isArray(encounters) ? encounters.find((e) => e.status === "in_progress") : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Section value={patient}>
        {(p) => (
          <header className="rounded-lg border border-slate-200 bg-white p-4">
            <h1 className="text-2xl font-semibold">
              {p.first_name} {p.middle_name} {p.last_name}
            </h1>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
              <div><dt className="inline font-medium">MRN </dt><dd className="inline font-mono" data-testid="mrn">{p.mrn}</dd></div>
              <div><dt className="inline font-medium">Age </dt><dd className="inline">{ageFrom(p.date_of_birth)} ({formatDate(p.date_of_birth)})</dd></div>
              <div><dt className="inline font-medium">Sex </dt><dd className="inline">{humanise(p.sex ?? "unknown")}</dd></div>
              <div><dt className="inline font-medium">Phone </dt><dd className="inline">{p.phone || "—"}</dd></div>
              <div><dt className="inline font-medium">Status </dt><dd className="inline">{humanise(p.status)}</dd></div>
            </dl>
          </header>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Allergies">
          <Section value={allergies}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-slate-600">No allergies recorded.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.substance}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[a.severity] ?? ""}`}>
                        {humanise(a.severity)}
                      </span>
                      <span className="text-sm text-slate-700">{a.reaction}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          </Section>
        </Card>

        <Card title="Problem list">
          <Section value={diagnoses}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-slate-600">No current diagnoses.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((d) => (
                    <li key={d.id}>
                      <span className="font-mono text-sm">{d.code}</span>{" "}
                      <span className="font-medium">{d.display}</span>{" "}
                      <span className="text-sm text-slate-600">
                        ({humanise(d.clinical_status ?? "active")}, {humanise(d.verification_status ?? "unconfirmed")})
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }
          </Section>
        </Card>
      </div>

      <Card title="Vital signs">
        <Section value={vitals}>
          {(sets) =>
            sets.length === 0 ? (
              <p className="text-slate-600">No vital signs recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Vital signs, most recent first</caption>
                  <thead className="text-slate-700">
                    <tr>
                      <th scope="col" className="p-2">Recorded</th>
                      <th scope="col" className="p-2">Readings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sets.map((set) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Section>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Prescribing"
          actions={
            openEncounter ? (
              <Link
                href={`/prescriptions/new?encounter=${openEncounter.id}`}
                className="min-h-11 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                New prescription
              </Link>
            ) : null
          }
        >
          <Section value={encounters}>
            {() =>
              openEncounter ? (
                <p className="text-sm text-slate-700">
                  Current visit: {humanise(openEncounter.encounter_class)} since{" "}
                  {formatDateTime(openEncounter.started_at)}.
                </p>
              ) : (
                <Notice tone="info" title="No visit in progress">Prescriptions are written within a visit.</Notice>
              )
            }
          </Section>
        </Card>

        <Card title="Bills">
          <Section value={invoices}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-slate-600">No bills.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((inv) => (
                    <li key={inv.id}>
                      <Link href={`/invoices/${inv.id}`} className="text-teal-800 underline">
                        Invoice of {formatDate(inv.created_at.slice(0, 10))}
                      </Link>{" "}
                      — {humanise(inv.payment_status)}, due {formatMoney(inv.net_due_minor, inv.currency)}
                    </li>
                  ))}
                </ul>
              )
            }
          </Section>
        </Card>
      </div>
    </div>
  );
}
