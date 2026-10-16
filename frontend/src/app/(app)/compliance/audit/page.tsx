"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Field, Loading, NoAccess, Select } from "@/components/legacy-ui";
import { api, type Schemas } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/format";

type Entry = Schemas["AuditEntry"];
type Filters = { action: string; outcome: string; resource: string; object_id: string };

const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "access",
  "login",
  "login_failed",
  "break_glass",
  "break_glass_review",
];

/** The tenant's audit log, newest first, with filters. Reading it is itself audited. */
export default function AuditLogPage() {
  const [filters, setFilters] = useState<Filters>({
    action: "",
    outcome: "",
    resource: "",
    object_id: "",
  });
  const [applied, setApplied] = useState<Filters>(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ rows: Entry[]; count: number } | "forbidden" | null>(null);

  useEffect(() => {
    setResult(null);
    const query = Object.fromEntries(Object.entries(applied).filter(([, v]) => v.trim()));
    api
      .GET("/api/audit/entries/", { params: { query: { ...query, page } } })
      .then(({ data, response }) =>
        setResult(
          response.status === 403
            ? "forbidden"
            : { rows: data?.results ?? [], count: data?.count ?? 0 },
        ),
      );
  }, [applied, page]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  }

  const pages = result && result !== "forbidden" ? Math.max(1, Math.ceil(result.count / 50)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <form
        onSubmit={apply}
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Select
          label="Action"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        >
          <option value="">Any</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {humanise(a)}
            </option>
          ))}
        </Select>
        <Select
          label="Outcome"
          value={filters.outcome}
          onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}
        >
          <option value="">Any</option>
          <option value="allowed">Allowed</option>
          <option value="denied">Denied</option>
          <option value="not_found">Not found</option>
          <option value="failed">Failed</option>
        </Select>
        <Field
          label="Resource"
          value={filters.resource}
          onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
          hint="For example patients.patient"
        />
        <Field
          label="Record id"
          value={filters.object_id}
          onChange={(e) => setFilters({ ...filters, object_id: e.target.value })}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit">Filter</Button>
        </div>
      </form>
      {result === null ? (
        <Loading />
      ) : result === "forbidden" ? (
        <NoAccess />
      ) : (
        <>
          <p className="text-sm text-slate-600" role="status">
            {result.count} entries
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Audit entries, newest first</caption>
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th scope="col" className="p-2">
                    When
                  </th>
                  <th scope="col" className="p-2">
                    Who
                  </th>
                  <th scope="col" className="p-2">
                    Action
                  </th>
                  <th scope="col" className="p-2">
                    Outcome
                  </th>
                  <th scope="col" className="p-2">
                    Resource
                  </th>
                  <th scope="col" className="p-2">
                    Record
                  </th>
                  <th scope="col" className="p-2">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((e) => (
                  <tr
                    key={e.id}
                    data-testid="audit-entry"
                    className={`border-t border-slate-100 ${e.outcome === "denied" ? "bg-red-50" : ""}`}
                  >
                    <td className="whitespace-nowrap p-2">{formatDateTime(e.occurred_at)}</td>
                    <td className="p-2">{e.actor_label || "—"}</td>
                    <td className="p-2">{humanise(e.action)}</td>
                    <td className="p-2">{humanise(e.outcome)}</td>
                    <td className="p-2 font-mono text-xs">{e.resource || "—"}</td>
                    <td className="p-2 font-mono text-xs">
                      {e.object_id ? e.object_id.slice(0, 8) : "—"}
                    </td>
                    <td className="p-2">{e.reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Pages" className="flex items-center gap-3">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Newer
            </Button>
            <span className="text-sm">
              Page {page} of {pages}
            </span>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Older
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
