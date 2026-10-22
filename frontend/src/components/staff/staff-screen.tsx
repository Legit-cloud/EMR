"use client";

import { Copy, IdentificationCard, UserGear } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Avatar } from "@/components/ui/avatar";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { KebabMenu } from "@/components/ui/menu";
import { SearchPill } from "@/components/ui/search-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import {
  licenceChip,
  roleLine,
  type StaffGroup,
  type StaffProfile,
  useStaffList,
  useStaffSummary,
} from "@/lib/staff";
import { SHIFT_STATUS } from "@/lib/status-map";
import { useDebounced } from "@/lib/use-debounced";

function columns(group: StaffGroup): Column<StaffProfile>[] {
  return [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <span className="flex items-center gap-3">
          <Avatar name={row.display_name} />
          <span className="flex min-w-0 flex-col">
            <span className="text-ink-900 truncate font-semibold">{row.display_name}</span>
            <span className="text-small text-ink-500 truncate">{roleLine(row)}</span>
          </span>
        </span>
      ),
    },
    ...(group === "general"
      ? [
          {
            id: "role",
            header: "Role",
            className: "hidden md:table-cell",
            cell: (row: StaffProfile) => <span className="text-ink-600">{roleLine(row)}</span>,
          },
        ]
      : [
          {
            id: "specialty",
            header: "Specialty",
            className: "hidden md:table-cell",
            cell: (row: StaffProfile) => (
              <span className="text-ink-600">{row.specialty || "—"}</span>
            ),
          },
        ]),
    {
      id: "shift",
      header: "Shift",
      cell: (row) => <StatusPill status={SHIFT_STATUS[row.on_duty ? "on_duty" : "off_duty"]} />,
    },
    {
      id: "licence",
      header: "Licence",
      cell: (row) => {
        const chip = licenceChip(row);
        return chip ? (
          <StatusPill status={chip} />
        ) : (
          <span className="text-small text-ink-500">Not required</span>
        );
      },
    },
  ];
}

/**
 * The staff directory: Doctors and General staff tabs with their counts, a searchable table
 * with shift status and a licence chip (amber when it expires soon, pink when it has expired).
 * Adding people and recording licence checks stay on the HR screen.
 */
export function StaffScreen() {
  const [group, setGroup] = useState<StaffGroup>("doctors");
  const permissions = usePermissions();
  const summary = useStaffSummary();

  if (summary.error instanceof ApiRequestError && summary.error.status === 403) {
    return <NoAccess what="the staff list" asPage />;
  }
  const data = summary.data;
  const needAttention = data ? data.licences_expiring + data.licences_expired : 0;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Staff list</h1>
        {data && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {data.doctors + data.general} staff
          </span>
        )}
        {permissions.hasRole("hr", "tenant_admin") && (
          <LinkButton variant="outline" icon={UserGear} href="/manage/staff" className="ml-auto">
            Manage staff and licences
          </LinkButton>
        )}
      </header>
      {needAttention > 0 && (
        <p role="status" className="text-body text-ink-600 flex items-center gap-2">
          <IdentificationCard aria-hidden size={18} />
          {data?.licences_expired ? `${data.licences_expired} expired` : null}
          {data?.licences_expired && data.licences_expiring ? " and " : null}
          {data?.licences_expiring ? `${data.licences_expiring} expiring soon` : null}
          {needAttention === 1 ? " licence needs" : " licences need"} attention.
        </p>
      )}
      <Tabs
        label="Staff"
        value={group}
        onValueChange={(value) => setGroup(value as StaffGroup)}
        items={[
          {
            value: "doctors",
            label: "Doctors",
            count: data?.doctors,
            content: <StaffTable group="doctors" />,
          },
          {
            value: "general",
            label: "General staff",
            count: data?.general,
            content: <StaffTable group="general" />,
          },
        ]}
      />
    </>
  );
}

function StaffTable({ group }: { group: StaffGroup }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const q = useDebounced(query.trim(), 300);
  const list = useStaffList({ group, q, page, pageSize });
  const cols = useMemo(() => columns(group), [group]);
  const label = group === "doctors" ? "Doctors" : "General staff";

  return (
    <section
      aria-label={label}
      className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <SearchPill
          variant="table"
          label={`Search ${label.toLowerCase()} by name, specialty or licence number`}
          placeholder="Search by name, specialty or licence number"
          className="w-full sm:w-96"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        caption={label}
        columns={cols}
        rows={list.data?.results}
        rowId={(row) => row.id}
        refreshing={list.isPlaceholderData}
        error={list.isError}
        onRetry={() => list.refetch()}
        actions={(row) => (
          <KebabMenu
            label={`Actions for ${row.display_name}`}
            items={[
              {
                label: "Copy licence number",
                icon: Copy,
                disabled: !row.licence_number,
                onSelect: () => {
                  navigator.clipboard
                    ?.writeText(row.licence_number ?? "")
                    .then(() => toast({ title: "Licence number copied", tone: "success" }))
                    .catch(() => toast({ title: "Could not copy the number", tone: "error" }));
                },
              },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize,
          total: list.data?.count ?? 0,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
        }}
        empty={
          <EmptyState
            title={q ? "No staff match your search." : `No ${label.toLowerCase()} yet.`}
          />
        }
      />
    </section>
  );
}
