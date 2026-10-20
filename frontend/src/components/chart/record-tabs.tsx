"use client";

import { DownloadSimple, Plus } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { api, apiError, type Schemas, unwrap } from "@/lib/api";
import { useAttachments, useInvoices, usePrescriptions, useRecordAudit } from "@/lib/chart-queries";
import { cx } from "@/lib/cx";
import { formatDateTime, formatMoney, humanise } from "@/lib/format";
import { AUDIT_OUTCOME, PAYMENT_STATUS, PRESCRIPTION_STATUS } from "@/lib/status-map";

import { QueryState } from "./query-state";

const LINK = cx("text-small rounded-tag font-semibold text-blue-600 hover:underline", FOCUS_RING);

type Prescription = Schemas["Prescription"];

/** Prescriptions written for this patient, newest first. */
export function PrescriptionsTab({
  patientId,
  openEncounterId,
}: {
  patientId: string;
  openEncounterId?: string;
}) {
  const prescriptions = usePrescriptions(patientId);
  const columns: Column<Prescription>[] = [
    {
      id: "date",
      header: "Date",
      cell: (p) => (
        <span className="tnum whitespace-nowrap">
          {formatDateTime(p.authorised_at ?? p.created_at)}
        </span>
      ),
    },
    {
      id: "medicines",
      header: "Medicines",
      cell: (p) => (
        <ul className="flex flex-col gap-0.5">
          {p.items.map((item) => (
            <li key={item.id}>
              <span className="text-ink-900 font-semibold">{item.drug_name}</span>
              <span className="text-small text-ink-600">
                {" "}
                · {item.dose}, {item.frequency}, {item.duration_days} days
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => <StatusPill status={PRESCRIPTION_STATUS[p.status]} />,
    },
  ];
  const prescribe = openEncounterId ? (
    <Link
      href={`/prescriptions/new?encounter=${openEncounterId}`}
      className={cx(
        "rounded-control text-body text-surface inline-flex h-10 items-center gap-2 bg-blue-600 px-4 font-semibold hover:bg-blue-700",
        FOCUS_RING,
      )}
    >
      <Plus aria-hidden size={20} />
      New prescription
    </Link>
  ) : undefined;

  return (
    <Card title="Prescriptions" action={prescribe}>
      <QueryState query={prescriptions} what="prescriptions">
        {(data) => (
          <DataTable
            caption="Prescriptions, most recent first"
            columns={columns}
            rows={data.results}
            rowId={(p) => p.id}
            empty={<EmptyState title="No prescriptions yet." action={prescribe} />}
          />
        )}
      </QueryState>
    </Card>
  );
}

type Invoice = Schemas["Invoice"];

/** Bills for this patient, linking to the invoice. */
export function BillingTab({ patientId }: { patientId: string }) {
  const invoices = useInvoices(patientId);
  const columns: Column<Invoice>[] = [
    {
      id: "date",
      header: "Date",
      cell: (i) => (
        <Link href={`/invoices/${i.id}`} className={cx("tnum whitespace-nowrap", LINK)}>
          {formatDateTime(i.created_at)}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (i) => <StatusPill status={PAYMENT_STATUS[i.payment_status]} />,
    },
    {
      id: "total",
      header: "Total",
      className: "text-right",
      cell: (i) => <span className="tnum">{formatMoney(i.total_minor, i.currency)}</span>,
    },
    {
      id: "due",
      header: "Still due",
      className: "text-right",
      cell: (i) => (
        <span className="tnum font-semibold">{formatMoney(i.net_due_minor, i.currency)}</span>
      ),
    },
  ];
  return (
    <Card title="Billing">
      <QueryState query={invoices} what="invoices">
        {(data) => (
          <DataTable
            caption="Invoices, most recent first"
            columns={columns}
            rows={data.results}
            rowId={(i) => i.id}
            empty={<EmptyState title="No bills yet." />}
          />
        )}
      </QueryState>
    </Card>
  );
}

type Attachment = Schemas["Attachment"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Documents uploaded to the record. Downloads use a short-lived signed link. */
export function DocumentsTab({ patientId }: { patientId: string }) {
  const toast = useToast();
  const attachments = useAttachments(patientId);
  const open = useMutation({
    mutationFn: async (id: string) => {
      const link = await unwrap(
        api.GET("/api/patients/attachments/{id}/download/", { params: { path: { id } } }),
      );
      window.open(link.url, "_blank", "noopener,noreferrer");
    },
    onError: (failure) =>
      toast({
        title: "Could not open the document",
        description: apiError(failure).message,
        tone: "error",
      }),
    meta: { quietErrors: true },
  });
  const columns: Column<Attachment>[] = [
    {
      id: "name",
      header: "Document",
      cell: (a) => <span className="text-ink-900 font-semibold">{a.original_name}</span>,
    },
    { id: "category", header: "Type", cell: (a) => humanise(a.category) },
    { id: "size", header: "Size", cell: (a) => <span className="tnum">{formatSize(a.size)}</span> },
    {
      id: "added",
      header: "Added",
      cell: (a) => <span className="tnum whitespace-nowrap">{formatDateTime(a.created_at)}</span>,
    },
  ];
  return (
    <Card title="Documents">
      <QueryState query={attachments} what="documents">
        {(data) => (
          <DataTable
            caption="Documents"
            columns={columns}
            rows={data.results}
            rowId={(a) => a.id}
            empty={<EmptyState title="No documents uploaded." />}
            actions={(a) => (
              <Button
                variant="ghost"
                icon={DownloadSimple}
                onClick={() => open.mutate(a.id)}
                aria-label={`Open ${a.original_name}`}
              >
                Open
              </Button>
            )}
          />
        )}
      </QueryState>
    </Card>
  );
}

type AuditEntry = Schemas["AuditEntry"];

/** Who read or changed this patient's record, for the roles that may see the audit log. */
export function AuditTab({ patientId, enabled }: { patientId: string; enabled: boolean }) {
  const audit = useRecordAudit(patientId, enabled);
  const columns: Column<AuditEntry>[] = [
    {
      id: "when",
      header: "When",
      cell: (e) => <span className="tnum whitespace-nowrap">{formatDateTime(e.occurred_at)}</span>,
    },
    { id: "who", header: "Who", cell: (e) => e.actor_label || "—" },
    { id: "action", header: "Action", cell: (e) => humanise(e.action) },
    {
      id: "outcome",
      header: "Outcome",
      cell: (e) => <StatusPill status={AUDIT_OUTCOME[e.outcome]} />,
    },
    {
      id: "reason",
      header: "Reason",
      cell: (e) => <span className="text-ink-600">{e.reason || "—"}</span>,
    },
  ];
  return (
    <Card title="Record access">
      <p className="text-small text-ink-600">
        Every time this patient&apos;s record was opened or changed, and by whom.
      </p>
      <QueryState query={audit} what="the record access log">
        {(data) => (
          <DataTable
            caption="Record access, most recent first"
            columns={columns}
            rows={data.results}
            rowId={(e) => e.id}
            empty={<EmptyState title="Nothing recorded yet." />}
          />
        )}
      </QueryState>
    </Card>
  );
}
