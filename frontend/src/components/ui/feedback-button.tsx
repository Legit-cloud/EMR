import { cx } from "@/lib/cx";

import { FOCUS_RING } from "./focus";

/** White pill at the bottom right with a green dot and "Feedback" (docs/DESIGN.md Section 7). */
export function FeedbackButton({
  onClick,
  floating = true,
}: {
  onClick: () => void;
  /** Fixed to the corner in the app; in flow on the /design page. */
  floating?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-pill bg-surface shadow-pop text-body text-ink-900 hover:bg-surface-muted inline-flex h-10 items-center gap-2 px-4 font-semibold",
        floating && "fixed right-6 bottom-6 z-40",
        FOCUS_RING,
      )}
    >
      <span aria-hidden className="bg-green size-2 rounded-full" />
      Feedback
    </button>
  );
}
