"use client";

import { DownloadSimple, ShieldWarning, SlidersHorizontal } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { SearchPill } from "@/components/ui/search-pill";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  ACTIONS,
  activeFilters,
  type AuditEntry,
  type AuditFilters,
  downloadAuditCsv,
  isBreakGlass,
  NO_FILTERS,
  useAuditList,
  useAuditSummary,
  useBreakGlassEntries,
} from "@/lib/audit";
import { cx } from "@/lib/cx";
import { formatDateTime, humanise } from "@/lib/format";
import { AUDIT_OUTCOME, TONES } from "@/lib/status-map";
import { useDebounced } from "@/lib/use-debounced";

const COLUMNS: Column<AuditEntry>[] = [
  {
    id: "when",
    header: "When",
    cell: (e) => (
      <span className="text-ink-600 tnum whitespace-nowrap">{formatDateTime(e.occurred_at)}</span>
    ),
  },
  {
    id: "who",
    header: "Who",
    cell: (e) => <span className="text-ink-900 font-semibold">{e.actor_label || "—"}</span>,
  },
  {
    id: "action",
    header: "Action",
    cell: (e) => (
      <span className={cx(isBreakGlass(e) && cx("font-semibold", TONES.pink.text))}>
        {humanise(e.action)}
      </span>
    ),
  },
  {
    id: "resource",
    header: "Resource",
    className: "hidden md:table-cell",
    cell: (e) => (
      <span className="flex flex-col">
        <span className="text-ink-900">{e.resource || "—"}</span>
        <span className="text-small text-ink-500 font-mono">{e.object_id}</span>
      </span>
    ),
  },
  {
    id: "outcome",
    header: "Outcome",
    cell: (e) => <StatusPill status={AUDIT_OUTCOME[e.outcome]} />,
  },
  {
    id: "reason",
    header: "Reason",
    className: "hidden xl:table-cell",
    cell: (e) => <span className="text-ink-600">{e.reason || "—"}</span>,
  },
];

/**
 * The tenant's audit log: filterable, with an export, and every break-glass access pinned
 * above the table with a pink tint so a reviewer sees it first. Reading the log, and exporting
 * it, are themselves audited by the server.
 */
export function AuditScreen() {
  const toast = useToast();
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  const q = useDebounced(filters.q.trim(), 300);
  const applied = useMemo(() => ({ ...filters, q }), [filters, q]);
  const list = useAuditList(applied, page, pageSize);
  const summary = useAuditSummary(applied);
  const pinned = useBreakGlassEntries(applied);
  const extra = activeFilters(filters);
  const searching = q !== "" || extra > 0;

  function change(patch: Partial<AuditFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadAuditCsv(applied);
      toast({ title: "Export downloaded", description: "audit-log.csv", tone: "success" });
    } catch {
      toast({ title: "The export could not be downloaded", tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="the audit log" asPage />;
  }

  const total = list.data?.count ?? 0;
  const counts = summary.data;
  const pinnedRows = pinned.data?.results ?? [];

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Audit log</h1>
        {list.data && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        )}
        <Button
          variant="outline"
          icon={DownloadSimple}
          className="ml-auto"
          loading={exporting}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
      </header>

      {counts && (
        <dl aria-label="Audit summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Entries", counts.total],
            ["Refused", counts.denied],
            ["Break-glass", counts.break_glass],
            ["Reviewed", counts.reviewed],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-card border-line bg-surface shadow-card flex flex-col gap-1 border p-4"
            >
              <dt className="text-small text-ink-600">{label}</dt>
              <dd className="text-card-title text-ink-900 tnum">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {pinnedRows.length > 0 && (
        <section
          aria-label="Break-glass access"
          className={cx("rounded-card border-line border p-5", TONES.pink.tint)}
        >
          <header className="mb-3 flex flex-wrap items-center gap-2">
            <ShieldWarning aria-hidden size={20} weight="fill" className={TONES.pink.icon} />
            <h2 className={cx("text-card-title", TONES.pink.text)}>Break-glass access</h2>
            <span className="text-small text-ink-600 ml-auto flex items-center gap-3">
              {pinned.data && pinned.data.count > pinnedRows.length
                ? `Latest ${pinnedRows.length} of ${pinned.data.count}`
                : null}
              <Button variant="ghost" onClick={() => change({ action: "break_glass" })}>
                Show only break-glass
              </Button>
              <Link
                href="/compliance"
                className={cx(
                  "rounded-tag font-semibold text-blue-600 hover:underline",
                  FOCUS_RING,
                )}
              >
                Review
              </Link>
            </span>
          </header>
          <ul className="flex flex-col">
            {pinnedRows.map((e) => (
              <li
                key={e.id}
                className="border-line flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t py-2 first:border-t-0"
              >
                <span className="text-small text-ink-600 tnum">
                  {formatDateTime(e.occurred_at)}
                </span>
                <span className="text-body text-ink-900 font-semibold">{e.actor_label}</span>
                <span className="text-body text-ink-900">{e.reason || "No reason recorded"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-label="Entries"
        className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
      >
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SearchPill
            variant="table"
            label="Search the audit log by person, resource or reason"
            placeholder="Search by person, resource or reason"
            className="w-full sm:w-96"
            value={filters.q}
            onChange={(e) => change({ q: e.target.value })}
          />
          <Popover
            title="Filters"
            trigger={
              <Button variant="neutral" icon={SlidersHorizontal}>
                {extra > 0 ? `Filters (${extra})` : "Filters"}
              </Button>
            }
          >
            <div className="flex flex-col gap-4">
              <Select
                label="Action"
                value={filters.action}
                onValueChange={(action) => change({ action })}
                options={[
                  { value: "all", label: "All actions" },
                  ...ACTIONS.map((a) => ({ value: a, label: humanise(a) })),
                ]}
              />
              <Select
                label="Outcome"
                value={filters.outcome}
                onValueChange={(outcome) => change({ outcome })}
                options={[
                  { value: "all", label: "All outcomes" },
                  ...Object.entries(AUDIT_OUTCOME).map(([value, spec]) => ({
                    value,
                    label: spec.label,
                  })),
                ]}
              />
              <Input
                label="From"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => change({ dateFrom: e.target.value })}
              />
              <Input
                label="To"
                type="date"
                value={filters.dateTo}
                onChange={(e) => change({ dateTo: e.target.value })}
              />
              {extra > 0 && (
                <div>
                  <Button variant="ghost" onClick={() => change({ ...NO_FILTERS, q: filters.q })}>
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          </Popover>
        </div>
        <DataTable
          caption="Entries"
          columns={COLUMNS}
          rows={list.data?.results}
          rowId={(e) => e.id}
          refreshing={list.isPlaceholderData}
          error={list.isError}
          onRetry={() => list.refetch()}
          rowClassName={(e) => (isBreakGlass(e) ? TONES.pink.tint : undefined)}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
          empty={
            <EmptyState
              title={searching ? "No entries match your search." : "The log is empty."}
              action={
                searching ? (
                  <Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                    Clear search and filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </section>
      <Card title="About this log">
        <p className="text-body text-ink-600">
          Entries cannot be changed or removed. Opening or exporting this log is recorded too.
        </p>
      </Card>
    </>
  );
}
