import type { Icon } from "@phosphor-icons/react";

import { cx } from "@/lib/cx";
import { type Tone, TONES } from "@/lib/status-map";

/** Rounded square with a tint fill and a solid icon: KPI headers, file types, drawer rows. */
export function IconTile({
  icon: Glyph,
  tone = "blue",
  size = 40,
}: {
  icon: Icon;
  tone?: Tone;
  size?: 36 | 40 | 44;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "rounded-control grid shrink-0 place-items-center",
        TONES[tone].tint,
        size === 36 ? "size-9" : size === 44 ? "size-11" : "size-10",
      )}
    >
      <Glyph size={size === 36 ? 20 : 24} weight="fill" className={TONES[tone].icon} />
    </span>
  );
}
