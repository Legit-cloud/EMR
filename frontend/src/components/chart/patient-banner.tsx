"use client";

import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Schemas } from "@/lib/api";
import { ageLabel, formatDate, humanise } from "@/lib/format";
import { PATIENT_STATUS } from "@/lib/status-map";

import { AllergyPills } from "./allergy-pills";

type Props = {
  patient: Schemas["Patient"];
  /** undefined while loading; the allergies the viewer may see. */
  allergies: Schemas["Allergy"][] | undefined;
  /** The break-glass notice or banner, kept inside the sticky area so it is always in view. */
  notice?: React.ReactNode;
};

/**
 * The patient banner: who this is and the one safety fact that must never be missed, their
 * allergies. Stays at the top while the chart scrolls (docs/DESIGN.md Section 8).
 */
export function PatientBanner({ patient, allergies, notice }: Props) {
  const name = [patient.first_name, patient.middle_name, patient.last_name]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="bg-canvas sticky top-0 z-20 -mx-4 flex flex-col gap-3 px-4 pt-1 pb-3 sm:-mx-6 sm:px-6">
      <header className="rounded-card border-line bg-surface shadow-card flex flex-wrap items-center gap-x-5 gap-y-3 border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} size={40} />
          <div className="min-w-0">
            <h1 className="text-page-title text-ink-900 truncate">{name}</h1>
            <p className="text-small text-ink-600 tnum">
              {ageLabel(patient.date_of_birth)} · {humanise(patient.sex ?? "unknown")} · born{" "}
              {formatDate(patient.date_of_birth)}
            </p>
          </div>
        </div>
        <dl className="text-small flex items-center gap-2">
          <dt className="text-label-caps text-ink-500 uppercase">MRN</dt>
          <dd className="text-ink-900 font-mono" data-testid="mrn">
            {patient.mrn}
          </dd>
        </dl>
        <StatusPill status={PATIENT_STATUS[patient.status]} />
        <div className="ml-auto min-w-0">
          {allergies === undefined ? (
            <Skeleton className="rounded-pill h-7 w-40" />
          ) : allergies.length === 0 ? (
            <p className="text-small text-ink-600">No allergy recorded</p>
          ) : (
            <AllergyPills allergies={allergies} />
          )}
        </div>
      </header>
      {notice}
    </div>
  );
}
