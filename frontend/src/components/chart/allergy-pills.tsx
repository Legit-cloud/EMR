import { FirstAid } from "@phosphor-icons/react";

import { cx } from "@/lib/cx";
import { humanise } from "@/lib/format";
import { TONES } from "@/lib/status-map";

type Allergy = { id: string; substance: string; severity: string; reaction?: string };

/** Pink allergy pills, one per allergy, severe ones filled (docs/DESIGN.md 2.4). */
export function AllergyPills({ allergies }: { allergies: Allergy[] }) {
  return (
    <ul aria-label="Allergies" className="flex flex-wrap gap-1.5">
      {allergies.map((a) => (
        <li
          key={a.id}
          className={cx(
            "text-small rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 font-semibold",
            TONES.pink.pill,
          )}
        >
          <FirstAid aria-hidden size={14} weight={a.severity === "severe" ? "fill" : "regular"} />
          {a.substance}
          <span className="font-medium">· {humanise(a.severity)}</span>
        </li>
      ))}
    </ul>
  );
}
