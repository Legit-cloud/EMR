import type { ReactNode } from "react";

/** Flat, original illustration in the accent palette: a tray with a document and a spark. */
function Illustration() {
  return (
    <svg aria-hidden viewBox="0 0 120 96" className="h-24 w-30">
      <ellipse cx="60" cy="86" rx="44" ry="6" className="fill-blue-50" />
      <rect
        x="34"
        y="14"
        width="52"
        height="62"
        rx="8"
        className="fill-surface stroke-line"
        strokeWidth="2"
      />
      <rect x="44" y="28" width="32" height="5" rx="2.5" className="fill-blue-100" />
      <rect x="44" y="40" width="24" height="5" rx="2.5" className="fill-skeleton" />
      <rect x="44" y="52" width="28" height="5" rx="2.5" className="fill-skeleton" />
      <path
        d="M20 60h22l6 10h24l6-10h22v18a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z"
        className="fill-blue-100"
      />
      <circle cx="94" cy="20" r="5" className="fill-amber" />
      <circle cx="24" cy="30" r="3" className="fill-teal" />
      <circle cx="102" cy="44" r="2.5" className="fill-pink" />
    </svg>
  );
}

type Props = {
  /** One sentence, for example "No appointments today." */
  title: string;
  /** One primary button, when there is something the user can do. */
  action?: ReactNode;
};

/** Illustration, one sentence, one action (docs/DESIGN.md Section 7). */
export function EmptyState({ title, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
      <Illustration />
      <p className="text-body text-ink-600">{title}</p>
      {action}
    </div>
  );
}
