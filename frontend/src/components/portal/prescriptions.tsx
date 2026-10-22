"use client";

import { Pill } from "@phosphor-icons/react";

import { IconTile } from "@/components/ui/icon-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDay } from "@/lib/format";
import { explainMedicine, plainInstructions } from "@/lib/plain-language";
import { usePrescriptions } from "@/lib/portal";
import type { StatusSpec } from "@/lib/status-map";

import { PortalCard, PortalHeading, QueryState } from "./shared";

const ACTIVE: StatusSpec = { label: "Taking now", tone: "green", icon: Pill };
const DONE: StatusSpec = { label: "Finished", tone: "grey", icon: Pill };

/** Medicines in everyday words: what each is for, and how to take it, written out. */
export function PortalPrescriptions() {
  const prescriptions = usePrescriptions();
  return (
    <>
      <PortalHeading
        title="Prescriptions"
        lead="Your medicines and how to take them. Ask your pharmacist if you are unsure."
      />
      <QueryState query={prescriptions} what="prescriptions" empty="You have no prescriptions yet.">
        {(rows) => (
          <ul className="flex flex-col gap-4">
            {rows.map((p) => (
              <li key={p.id}>
                <PortalCard
                  title={`Prescribed ${formatDay(p.prescribed_at)}`}
                  action={<StatusPill status={p.active ? ACTIVE : DONE} />}
                >
                  <p className="text-small text-ink-600">By {p.doctor_name}</p>
                  <ul className="flex flex-col gap-4">
                    {p.items.map((item) => (
                      <li key={item.id} className="flex items-start gap-3">
                        <IconTile icon={Pill} tone="sky" size={44} />
                        <div className="flex min-w-0 flex-col gap-1">
                          <h3 className="text-body text-ink-900 font-bold">{item.drug_name}</h3>
                          <p className="text-body text-ink-600">
                            {explainMedicine(item.drug_name)}
                          </p>
                          <p className="text-body text-ink-900">{plainInstructions(item)}</p>
                          {item.instructions && (
                            <p className="text-body text-ink-900">{item.instructions}</p>
                          )}
                          <p className="text-small text-ink-600 tnum">
                            You were given {item.quantity}.
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </PortalCard>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </>
  );
}
