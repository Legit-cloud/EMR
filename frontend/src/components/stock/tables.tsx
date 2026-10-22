"use client";

import { Check, Storefront } from "@phosphor-icons/react";
import Link from "next/link";

import type { Column } from "@/components/ui/data-table";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconTile } from "@/components/ui/icon-tile";
import { ProgressBar } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/status-pill";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS, STOCK_LEVEL, TONES } from "@/lib/status-map";
import { type InventoryRow, itemsText, type OrderRow, stockHref } from "@/lib/stock";

export function inventoryColumns(canOrder: boolean): Column<InventoryRow>[] {
  return [
    {
      id: "product",
      header: "Product",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-ink-900 truncate font-semibold">
            {row.name} {row.strength}
          </span>
          <span className="text-small text-ink-500 capitalize">{row.form}</span>
        </span>
      ),
    },
    {
      id: "level",
      header: "Level",
      cell: (row) => <StatusPill status={STOCK_LEVEL[row.stock_status]} />,
    },
    {
      id: "available",
      header: "Available",
      className: "text-right",
      cell: (row) => <span className="tnum">{row.available}</span>,
    },
    {
      id: "reorder",
      header: "Reorder at",
      className: "hidden text-right lg:table-cell",
      cell: (row) => <span className="tnum text-ink-600">{row.reorder_level}</span>,
    },
    {
      id: "on-order",
      header: "On order",
      className: "hidden text-right md:table-cell",
      cell: (row) => (
        <span className={cx("tnum", row.on_order > 0 ? "text-ink-900" : "text-ink-500")}>
          {row.on_order}
        </span>
      ),
    },
    {
      id: "value",
      header: "Value",
      className: "text-right",
      cell: (row) => (
        <span className="tnum whitespace-nowrap">{formatMoney(row.value_minor, row.currency)}</span>
      ),
    },
    {
      id: "order",
      header: "",
      className: "w-24 text-right",
      cell: (row) =>
        canOrder && row.stock_status !== "in_stock" ? (
          <Link
            href={stockHref({ tab: "orders", order: row.id })}
            aria-label={`Order ${row.name} ${row.strength}`}
            className={cx(
              "text-small rounded-tag px-1 font-semibold text-blue-600 underline",
              FOCUS_RING,
            )}
          >
            Order
          </Link>
        ) : null,
    },
  ];
}

/** Order id with "n items • total" under it, vendor, status, progress, email sent, then actions. */
export function orderColumns(receive: (row: OrderRow) => React.ReactNode): Column<OrderRow>[] {
  return [
    {
      id: "order",
      header: "Order",
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-ink-900 tnum font-semibold">{row.reference}</span>
          <span className="text-small text-ink-500 tnum">
            {itemsText(row.line_count)} • {formatMoney(row.total_minor, row.currency)}
          </span>
        </span>
      ),
    },
    {
      id: "created",
      header: "Created",
      sortKey: "created",
      className: "hidden lg:table-cell",
      cell: (row) => (
        <span className="text-ink-600 tnum whitespace-nowrap">{formatDay(row.created_at)}</span>
      ),
    },
    {
      id: "vendor",
      header: "Vendor",
      sortKey: "vendor",
      cell: (row) => (
        <span className="flex items-center gap-2.5">
          <IconTile icon={Storefront} tone="sky" size={36} />
          <span className="text-ink-900 truncate">{row.vendor_name}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortKey: "status",
      cell: (row) => <StatusPill status={ORDER_STATUS[row.status]} />,
    },
    {
      id: "received",
      header: "Items received",
      className: "hidden min-w-40 md:table-cell",
      cell: (row) => (
        <ProgressBar
          label={`Units received for ${row.reference}`}
          value={row.units_received}
          max={row.units_ordered}
        />
      ),
    },
    {
      id: "email",
      header: "Email sent",
      className: "hidden text-center xl:table-cell",
      cell: (row) =>
        row.email_sent_at ? (
          <span
            className={cx("inline-flex", TONES.green.text)}
            title={`Emailed ${formatDay(row.email_sent_at)}`}
          >
            <Check aria-hidden size={18} weight="bold" />
            <span className="sr-only">Email sent {formatDay(row.email_sent_at)}</span>
          </span>
        ) : (
          <span className="text-ink-400">
            <span aria-hidden>–</span>
            <span className="sr-only">Not emailed</span>
          </span>
        ),
    },
    { id: "receive", header: "", className: "w-28", cell: receive },
  ];
}
