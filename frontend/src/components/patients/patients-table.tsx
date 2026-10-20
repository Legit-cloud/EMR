"use client";

import { Copy, FirstAid, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { type Column, type Sort } from "@/components/ui/data-table";
import { FOCUS_RING } from "@/components/ui/focus";
import { KebabMenu } from "@/components/ui/menu";
import { StatusPill } from "@/components/ui/status-pill";
import type { Schemas } from "@/lib/api";
import { cx } from "@/lib/cx";
import { ageLabel, formatDay, humanise } from "@/lib/format";
import { PATIENT_STATUS, TONES } from "@/lib/status-map";

export type PatientRow = Schemas["PatientList"];

export function fullName(patient: Pick<PatientRow, "first_name" | "middle_name" | "last_name">) {
  return [patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(" ");
}

/** Pink chip: the first allergy, and how many more there are. Pink is also spelled out. */
export function AllergyChip({ allergies }: { allergies: PatientRow["allergies"] }) {
  if (allergies.length === 0) {
    return (
      <span className="text-ink-500">
        <span aria-hidden>—</span>
        <span className="sr-only">No allergy recorded</span>
      </span>
    );
  }
  const [first, ...rest] = allergies;
  const worst = allergies.some((a) => a.severity === "severe");
  return (
    <span
      title={allergies.map((a) => `${a.substance} (${a.severity})`).join(", ")}
      className={cx(
        "text-small rounded-pill inline-flex max-w-44 items-center gap-1.5 px-2.5 py-1 font-semibold",
        TONES.pink.pill,
      )}
    >
      <FirstAid aria-hidden size={14} weight={worst ? "fill" : "regular"} className="shrink-0" />
      <span className="sr-only">Allergy: </span>
      <span className="truncate">{first.substance}</span>
      {rest.length > 0 && <span className="tnum shrink-0">+{rest.length}</span>}
    </span>
  );
}

/** The register's sort keys and what the API calls them. */
export function toOrdering(sort: Sort | null): string | undefined {
  if (!sort) return undefined;
  const desc = sort.direction === "desc";
  switch (sort.key) {
    case "name":
      return desc ? "-name" : "name";
    case "mrn":
      return desc ? "-mrn" : "mrn";
    // Ascending age means youngest first, which is the latest birth date first.
    case "age":
      return desc ? "date_of_birth" : "-date_of_birth";
    default:
      return undefined;
  }
}

export function patientColumns(): Column<PatientRow>[] {
  return [
    {
      id: "name",
      header: "Patient",
      sortKey: "name",
      cell: (p) => (
        <Link
          href={`/patients/${p.id}`}
          className={cx("rounded-tag -mx-1 flex items-center gap-3 px-1", FOCUS_RING)}
        >
          <Avatar name={fullName(p)} />
          <span className="text-ink-900 font-semibold">{fullName(p)}</span>
        </Link>
      ),
    },
    {
      id: "mrn",
      header: "MRN",
      sortKey: "mrn",
      cell: (p) => <span className="text-small font-mono whitespace-nowrap">{p.mrn}</span>,
    },
    {
      id: "age",
      header: "Age and sex",
      sortKey: "age",
      cell: (p) => (
        <span className="tnum whitespace-nowrap">
          {ageLabel(p.date_of_birth)}
          <span className="text-ink-600"> · {humanise(p.sex ?? "unknown")}</span>
        </span>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      // Secondary on a tablet: allergies and status keep the room.
      className: "hidden xl:table-cell",
      cell: (p) => <span className="tnum whitespace-nowrap">{p.phone || "—"}</span>,
    },
    {
      id: "last_visit",
      header: "Last visit",
      cell: (p) => (
        <span className="text-ink-600 tnum whitespace-nowrap">{formatDay(p.last_visit)}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => <StatusPill status={PATIENT_STATUS[p.status]} />,
    },
    { id: "allergies", header: "Allergies", cell: (p) => <AllergyChip allergies={p.allergies} /> },
  ];
}

export function PatientActions({
  patient,
  onCopyMrn,
  onOpen,
}: {
  patient: PatientRow;
  onCopyMrn: (mrn: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <KebabMenu
      label={`Actions for ${fullName(patient)}`}
      items={[
        { label: "Open chart", icon: UserCircle, onSelect: () => onOpen(patient.id) },
        { label: "Copy MRN", icon: Copy, onSelect: () => onCopyMrn(patient.mrn) },
      ]}
    />
  );
}
