"use client";

import { Archive, ArrowDown, ArrowUp, ClipboardText, Plus } from "@phosphor-icons/react";
import { useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiBlock } from "@/components/ui/kpi";
import { KebabMenu } from "@/components/ui/menu";
import { SearchPill } from "@/components/ui/search-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { ApiRequestError } from "@/lib/api";
import { levelOf, type SupplyItem, useSupplies, useSupplySummary } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { usePermissions } from "@/lib/permissions";
import { SUPPLY_LEVEL } from "@/lib/status-map";
import { useDebounced } from "@/lib/use-debounced";

import { ItemDialog } from "./item-dialog";
import { MovementDialog, type MovementTarget } from "./movement-dialog";

const COLUMNS: Column<SupplyItem>[] = [
    {
        id: "item",
        header: "Supply",
        cell: (row) => (
            <span className="flex min-w-0 flex-col">
                <span className="text-ink-900 truncate font-semibold">{row.name}</span>
                <span className="text-small text-ink-500 truncate">
                    {row.sku}
                    {row.category ? ` · ${row.category}` : ""}
                </span>
            </span>
        ),
    },
    {
        id: "on_hand",
        header: "On hand",
        cell: (row) => (
            <span className="tnum">
                {row.on_hand} {row.unit}
            </span>
        ),
    },
    {
        id: "reorder",
        header: "Reorder at",
        className: "hidden md:table-cell",
        cell: (row) => <span className="tnum text-ink-600">{row.reorder_level ?? 0}</span>,
    },
    {
        id: "value",
        header: "Value",
        className: "hidden md:table-cell",
        cell: (row) => (
            <span className="tnum text-ink-600">
                {formatMoney(row.on_hand * (row.unit_cost_minor ?? 0), row.currency ?? "NGN")}
            </span>
        ),
    },
    {
        id: "level",
        header: "Level",
        cell: (row) => <StatusPill status={SUPPLY_LEVEL[levelOf(row)]} />,
    },
];

/**
 * General supplies: totals, a searchable list with a low-stock filter, and the three ways stock
 * changes (received, issued, count corrected). Drugs are on the pharmacy stock screen.
 */
export function InventoryScreen() {
    const permissions = usePermissions();
    const summary = useSupplySummary();
    const [query, setQuery] = useState("");
    const [low, setLow] = useState(false);
    const [page, setPage] = useState(1);
    const q = useDebounced(query.trim(), 300);
    const list = useSupplies({ q, low, page });
    const [adding, setAdding] = useState(false);
    const [moving, setMoving] = useState<MovementTarget | null>(null);

    if (
        (summary.error instanceof ApiRequestError && summary.error.status === 403) ||
        (list.error instanceof ApiRequestError && list.error.status === 403)
    ) {
        return <NoAccess what="supplies" asPage />;
    }
    const canManage = permissions.hasRole("pharmacist", "tenant_admin");
    const canReceive = permissions.hasRole("pharmacist");
    const canIssue = permissions.hasRole("pharmacist", "nurse");
    const data = summary.data;

    return (
        <>
            <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <h1 className="text-page-title text-ink-900">Supplies</h1>
                {canManage && (
                    <Button icon={Plus} className="ml-auto" onClick={() => setAdding(true)}>
                        Add supply
                    </Button>
                )}
            </header>
            <section
                aria-label="Supply totals"
                className="rounded-card border-line bg-surface shadow-card grid gap-4 border p-5 sm:grid-cols-2 lg:grid-cols-4"
            >
                <KpiBlock label="Supplies" value={data ? String(data.items) : "—"} />
                <KpiBlock
                    label="Stock value"
                    value={data ? formatMoney(data.value_minor, data.currency) : "—"}
                />
                <KpiBlock label="Low" value={data ? String(data.low) : "—"} />
                <KpiBlock label="Out of stock" value={data ? String(data.out) : "—"} />
            </section>
            <section
                aria-label="Supplies list"
                className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
            >
                <div className="flex flex-wrap items-center gap-3 p-4">
                    <SearchPill
                        variant="table"
                        label="Search supplies by name or code"
                        placeholder="Search by name or code"
                        className="w-full sm:w-96"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                        }}
                    />
                    <label className="text-body text-ink-700 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={low}
                            onChange={(e) => {
                                setLow(e.target.checked);
                                setPage(1);
                            }}
                        />
                        Low or out of stock only
                    </label>
                </div>
                <DataTable
                    caption="Supplies"
                    columns={COLUMNS}
                    rows={list.data?.results}
                    rowId={(row) => row.id}
                    refreshing={list.isPlaceholderData}
                    error={list.isError}
                    onRetry={() => list.refetch()}
                    actions={(row) => {
                        const items = [
                            ...(canReceive
                                ? [
                                      {
                                          label: "Receive stock",
                                          icon: ArrowDown,
                                          onSelect: () =>
                                              setMoving({ item: row, kind: "receive" as const }),
                                      },
                                  ]
                                : []),
                            ...(canIssue
                                ? [
                                      {
                                          label: "Issue stock",
                                          icon: ArrowUp,
                                          disabled: row.on_hand === 0,
                                          onSelect: () =>
                                              setMoving({ item: row, kind: "issue" as const }),
                                      },
                                  ]
                                : []),
                            ...(canReceive
                                ? [
                                      {
                                          label: "Correct the count",
                                          icon: ClipboardText,
                                          onSelect: () =>
                                              setMoving({ item: row, kind: "adjust" as const }),
                                      },
                                  ]
                                : []),
                        ];
                        return items.length > 0 ? (
                            <KebabMenu label={`Actions for ${row.name}`} items={items} />
                        ) : null;
                    }}
                    pagination={{
                        page,
                        pageSize: 25,
                        total: list.data?.count ?? 0,
                        onPageChange: setPage,
                        onPageSizeChange: () => undefined,
                    }}
                    empty={
                        <EmptyState
                            title={q || low ? "No supplies match." : "No supplies yet."}
                            action={
                                canManage && !q && !low ? (
                                    <Button icon={Archive} onClick={() => setAdding(true)}>
                                        Add the first supply
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                />
            </section>
            <ItemDialog open={adding} onOpenChange={setAdding} />
            <MovementDialog target={moving} onOpenChange={(open) => !open && setMoving(null)} />
        </>
    );
}
