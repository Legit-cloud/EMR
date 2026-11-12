"use client";

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { type DiagnosticOrder, KIND_LABEL, usePatientOrders } from "@/lib/diagnostics";
import { formatDateTime } from "@/lib/format";
import { DIAGNOSTIC_STATUS, RESULT_FLAG } from "@/lib/status-map";

import { QueryState } from "./query-state";

/**
 * Laboratory and imaging for this patient, newest first, with the result when there is one.
 * Orders are placed and resulted from Tests and scans.
 */
export function TestsTab({ patientId }: { patientId: string }) {
  const orders = usePatientOrders(patientId);
  return (
    <Card
      title="Tests and scans"
      action={
        <Link
          href="/diagnostics"
          className="text-small font-semibold text-blue-600 hover:underline"
        >
          Open the worklist
        </Link>
      }
    >
      <QueryState query={orders} what="tests and scans">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No tests or scans have been ordered for this patient." />
          ) : (
            <ul className="flex flex-col">
              {rows.map((order) => (
                <Row key={order.id} order={order} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}

function Row({ order }: { order: DiagnosticOrder }) {
  const result = order.current_result;
  return (
    <li className="border-line flex flex-col gap-1.5 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body text-ink-900 font-semibold">{order.investigation_name}</span>
        <span className="text-small text-ink-500">{KIND_LABEL[order.kind] ?? order.kind}</span>
        <StatusPill status={DIAGNOSTIC_STATUS[order.status]} />
        {result && <StatusPill status={RESULT_FLAG[result.flag]} />}
      </div>
      <p className="text-small text-ink-600">
        Ordered {formatDateTime(order.created_at)} by {order.ordered_by_name}: {order.reason}
      </p>
      {result && (
        <div className="text-body text-ink-900">
          {result.value && (
            <p>
              {result.value} {result.unit}
              {result.reference_range && (
                <span className="text-small text-ink-500"> (usual {result.reference_range})</span>
              )}
            </p>
          )}
          {result.report && <p className="whitespace-pre-line">{result.report}</p>}
          <p className="text-small text-ink-500">
            {result.is_reviewed ? "Reviewed by a doctor." : "Not yet reviewed by a doctor."}
            {result.version > 1 ? ` Corrected: ${result.correction_reason}` : ""}
          </p>
        </div>
      )}
      {order.status === "cancelled" && (
        <p className="text-small text-ink-600">Cancelled: {order.cancelled_reason}</p>
      )}
    </li>
  );
}
