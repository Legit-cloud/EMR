"use client";

import Link from "next/link";
import { use } from "react";

import { Card, Notice } from "@/components/legacy-ui";
import { api, type Schemas } from "@/lib/api";
import { ageFrom, formatDate, formatDateTime, formatMoney, humanise } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";

import { AllergiesSection } from "./_sections/allergies";
import { Show } from "./_sections/common";
import { DiagnosesSection } from "./_sections/diagnoses";
import { NotesSection } from "./_sections/notes";
import { VisitPanel } from "./_sections/visit";
import { VitalsSection } from "./_sections/vitals";

/**
 * The patient chart. Each section loads its own data and shows "no access" when the
 * API refuses it, so every role sees what it may see and nothing is hidden client-side.
 */
export default function PatientChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [patient] = useLoad<Schemas["Patient"]>(
    () => api.GET("/api/patients/patients/{id}/", { params: { path: { id } } }),
    [id],
  );
  const [encounters, reloadEncounters] = useLoad<Schemas["Encounter"][]>(
    () => api.GET("/api/clinical/encounters/", { params: { query: { patient: id } } }),
    [id],
  );
  const [invoices] = useLoad<Schemas["Invoice"][]>(
    () => api.GET("/api/billing/invoices/", { params: { query: { patient: id } } }),
    [id],
  );

  const openEncounter = Array.isArray(encounters)
    ? encounters.find((e) => e.status === "in_progress")
    : undefined;
  const clinical = encounters !== "forbidden";

  return (
    <div className="flex flex-col gap-4">
      <Show value={patient}>
        {(p) => (
          <header className="rounded-lg border border-slate-200 bg-white p-4">
            <h1 className="text-2xl font-semibold">
              {p.first_name} {p.middle_name} {p.last_name}
            </h1>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
              <div>
                <dt className="inline font-medium">MRN </dt>
                <dd className="inline font-mono" data-testid="mrn">
                  {p.mrn}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Age </dt>
                <dd className="inline">
                  {ageFrom(p.date_of_birth)} ({formatDate(p.date_of_birth)})
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Sex </dt>
                <dd className="inline">{humanise(p.sex ?? "unknown")}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Phone </dt>
                <dd className="inline">{p.phone || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Status </dt>
                <dd className="inline">{humanise(p.status)}</dd>
              </div>
            </dl>
          </header>
        )}
      </Show>

      {clinical && (
        <VisitPanel patientId={id} openEncounter={openEncounter} onChange={reloadEncounters} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AllergiesSection patientId={id} />
        <DiagnosesSection patientId={id} encounterId={openEncounter?.id} />
      </div>
      <VitalsSection patientId={id} encounterId={openEncounter?.id} />
      <NotesSection patientId={id} encounterId={openEncounter?.id} />

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
          <Show value={encounters}>
            {() =>
              openEncounter ? (
                <p className="text-sm text-slate-700">
                  Prescriptions are written within the current visit.
                </p>
              ) : (
                <Notice tone="info" title="No visit in progress">
                  Start a visit to prescribe.
                </Notice>
              )
            }
          </Show>
        </Card>

        <Card title="Bills">
          <Show value={invoices}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-slate-600">No bills.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((inv) => (
                    <li key={inv.id}>
                      <Link href={`/invoices/${inv.id}`} className="text-teal-800 underline">
                        Invoice of {formatDateTime(inv.created_at)}
                      </Link>{" "}
                      — {humanise(inv.payment_status)}, due{" "}
                      {formatMoney(inv.net_due_minor, inv.currency)}
                    </li>
                  ))}
                </ul>
              )
            }
          </Show>
        </Card>
      </div>
    </div>
  );
}
