"use client";

import { LockKey } from "@phosphor-icons/react";
import Link from "next/link";

import { FOCUS_RING } from "@/components/ui/focus";
import { IconTile } from "@/components/ui/icon-tile";
import { cx } from "@/lib/cx";

type Props = {
  /** What was refused, for example "this patient's prescriptions". */
  what?: string;
  /** Use h1 when the refusal is the whole page. */
  asPage?: boolean;
};

/**
 * Shown when the API refuses a request (403). No data from the refused request is shown;
 * the message says how to get access instead.
 */
export function NoAccess({ what = "this page", asPage = false }: Props) {
  const Heading = asPage ? "h1" : "h2";
  return (
    <div role="status" className="flex flex-col items-center gap-4 px-4 py-12 text-center">
      <IconTile icon={LockKey} tone="grey" size={44} />
      <Heading className={cx(asPage ? "text-display" : "text-card-title", "text-ink-900")}>
        You do not have access to {what}
      </Heading>
      <p className="text-body text-ink-600 max-w-md">
        Your role or assignment does not cover it. If you need it for your work, ask your
        administrator to change your access.
      </p>
      <Link
        href="/dashboard"
        className={cx(
          "rounded-control text-body text-surface bg-blue-600 px-4 py-2.5 font-semibold hover:bg-blue-700",
          FOCUS_RING,
        )}
      >
        Go to the dashboard
      </Link>
    </div>
  );
}
