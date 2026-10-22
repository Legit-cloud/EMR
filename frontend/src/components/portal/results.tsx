"use client";

import { Flask, Scan } from "@phosphor-icons/react";
import { useState } from "react";

import { IconTile } from "@/components/ui/icon-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDay } from "@/lib/format";
import {
  describeRange,
  explainTest,
  RESULT_FLAG_TEXT,
  type ResultFlag,
} from "@/lib/plain-language";
import { type PortalResult, useMarkSeen, useResults } from "@/lib/portal";
import type { StatusSpec } from "@/lib/status-map";

import { PortalButton, PortalCard, PortalHeading, QueryState } from "./shared";

/** Colour and icon for how a result sits; the words always say it too. */
const FLAG_PILL: Record<ResultFlag, StatusSpec> = {
  normal: { label: RESULT_FLAG_TEXT.normal.label, tone: "green", icon: Flask },
  low: { label: RESULT_FLAG_TEXT.low.label, tone: "amber", icon: Flask },
  high: { label: RESULT_FLAG_TEXT.high.label, tone: "amber", icon: Flask },
  abnormal: { label: RESULT_FLAG_TEXT.abnormal.label, tone: "amber", icon: Flask },
};

/**
 * Results in everyday words. Each one says what the test is, the number and the usual range, and
 * where it sits, and never a diagnosis: "your doctor will tell you what it means for you".
 * New ones are marked until opened.
 */
export function PortalResults() {
  const results = useResults();
  return (
    <>
      <PortalHeading
        title="Results"
        lead="Your tests and scans. If anything worries you, speak to your doctor."
      />
      <QueryState query={results} what="results" empty="You have no results yet.">
        {(rows) => (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Result result={r} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </>
  );
}

function Result({ result }: { result: PortalResult }) {
  const [open, setOpen] = useState(false);
  const seen = useMarkSeen();
  const range = describeRange(result.low, result.high, result.unit);
  const detailId = `result-${result.id}`;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !result.seen) seen.mutate(result.id);
  }

  return (
    <PortalCard>
      <div className="flex items-start gap-3">
        <IconTile icon={result.kind === "imaging" ? Scan : Flask} tone="purple" size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-card-title text-ink-900">{result.name}</h2>
            {!result.seen && (
              <span className="text-pill rounded-tag bg-blue-100 px-2 py-0.5 font-bold text-blue-600 uppercase">
                New
              </span>
            )}
          </div>
          <p className="text-small text-ink-600">
            {formatDay(result.taken_at)} · ordered by {result.ordered_by}
          </p>
          <p className="text-body text-ink-900">{explainTest(result.name)}</p>
        </div>
      </div>
      <div>
        <StatusPill status={FLAG_PILL[result.flag]} />
      </div>
      <div>
        <PortalButton
          variant="outline"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={`${open ? "Hide" : "Read"} the ${result.name} result`}
          onClick={toggle}
        >
          {open ? "Hide result" : "Read result"}
        </PortalButton>
      </div>
      {open && (
        <div id={detailId} className="border-line flex flex-col gap-2 border-t pt-3">
          {result.value && (
            <p className="text-body text-ink-900">
              Your result: <strong className="tnum">{result.value}</strong>
              {result.unit ? ` ${result.unit}` : ""}
            </p>
          )}
          {range && <p className="text-body text-ink-600">{range}</p>}
          <p className="text-body text-ink-900">{RESULT_FLAG_TEXT[result.flag].sentence}</p>
          {result.note && <p className="text-body text-ink-900">{result.note}</p>}
        </div>
      )}
    </PortalCard>
  );
}
