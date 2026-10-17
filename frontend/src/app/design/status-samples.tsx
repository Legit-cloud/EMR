"use client";

import { StatusPill } from "@/components/ui/status-pill";
import {
  APPOINTMENT_STATUS,
  BED_STATUS,
  PAYMENT_STATUS,
  type StatusSpec,
  TONES,
  TRIAGE_LEVEL,
} from "@/lib/status-map";

const GROUPS: { title: string; map: Record<string, StatusSpec> }[] = [
  { title: "Appointment", map: APPOINTMENT_STATUS },
  { title: "Payment", map: PAYMENT_STATUS },
  { title: "Triage", map: TRIAGE_LEVEL },
  { title: "Bed", map: BED_STATUS },
];

/** Every status from src/lib/status-map.ts as a pill and as a calendar card. */
export function StatusSamples() {
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map(({ title, map }) => (
        <div key={title} className="flex flex-col gap-3">
          <h3 className="text-label-caps text-ink-500 uppercase">{title}</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(map).map(([key, spec]) => (
              <StatusPill key={key} status={spec} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(map).map(([key, spec]) => {
              const tone = TONES[spec.tone];
              const Icon = spec.icon;
              return (
                <div
                  key={key}
                  className={`rounded-cal flex w-44 items-center gap-2 p-2 ${tone.card}`}
                >
                  <span className="rounded-tag bg-surface grid size-7 place-items-center">
                    <Icon aria-hidden size={16} weight="fill" className={tone.icon} />
                  </span>
                  <span className={`text-small ${tone.text}`}>{spec.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
