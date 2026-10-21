"use client";

import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import type { Column } from "@/components/ui/data-table";
import { FOCUS_RING } from "@/components/ui/focus";
import { StatusPill } from "@/components/ui/status-pill";
import { type InvoiceRow, invoiceHref } from "@/lib/billing";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ESTATE_REVIEW, PAYMENT_STATUS } from "@/lib/status-map";

/** "5 items • ₦10,300.00": the grey line under the invoice number. */
export function itemsLine(row: Pick<InvoiceRow, "line_count" | "total_minor" | "currency">) {
  const items = `${row.line_count} ${row.line_count === 1 ? "item" : "items"}`;
  return `${items} • ${formatMoney(row.total_minor, row.currency)}`;
}

export function invoiceColumns(): Column<InvoiceRow>[] {
  return [
    {
      id: "invoice",
      header: "Invoice",
      cell: (row) => (
        <Link
          href={invoiceHref(row.id)}
          scroll={false}
          aria-label={`Open invoice ${row.reference}`}
          className={cx("rounded-tag -mx-1 flex flex-col px-1", FOCUS_RING)}
        >
          <span className="text-ink-900 tnum font-semibold">{row.reference}</span>
          <span className="text-small text-ink-500 tnum">{itemsLine(row)}</span>
        </Link>
      ),
    },
    {
      id: "patient",
      header: "Patient",
      cell: (row) => (
        <span className="flex items-center gap-3">
          <Avatar name={row.patient_name || "Patient"} />
          <span className="flex min-w-0 flex-col">
            <span className="text-ink-900 truncate font-semibold">{row.patient_name || "—"}</span>
            <span className="text-small text-ink-500 font-mono">{row.patient_mrn}</span>
          </span>
        </span>
      ),
    },
    {
      id: "created",
      header: "Opened",
      sortKey: "created",
      className: "hidden lg:table-cell",
      cell: (row) => (
        <span className="text-ink-600 tnum whitespace-nowrap">{formatDay(row.created_at)}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortKey: "status",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={PAYMENT_STATUS[row.payment_status]} />
          {row.estate_review && <StatusPill status={ESTATE_REVIEW} />}
        </span>
      ),
    },
    {
      id: "total",
      header: "Total",
      sortKey: "total",
      className: "text-right",
      cell: (row) => (
        <span className="tnum whitespace-nowrap">{formatMoney(row.total_minor, row.currency)}</span>
      ),
    },
    {
      id: "due",
      header: "Still due",
      sortKey: "due",
      className: "text-right",
      cell: (row) => (
        <span
          className={cx(
            "tnum whitespace-nowrap",
            row.net_due_minor > 0 ? "text-ink-900 font-semibold" : "text-ink-500",
          )}
        >
          {formatMoney(row.net_due_minor, row.currency)}
        </span>
      ),
    },
  ];
}
