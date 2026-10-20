"use client";

import { Plus, SlidersHorizontal, UsersThree } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { PatientActions, patientColumns, toOrdering } from "@/components/patients/patients-table";
import { RegistrationWizard } from "@/components/patients/registration-wizard";
import { Button } from "@/components/ui/button";
import { DataTable, type Sort } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus";
import { Popover } from "@/components/ui/popover";
import { SearchPill } from "@/components/ui/search-pill";
import { Select } from "@/components/ui/select";
import { Loading } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, unwrap } from "@/lib/api";
import { cx } from "@/lib/cx";
import { usePermissions } from "@/lib/permissions";
import { useDebounced } from "@/lib/use-debounced";

// Built once: the table re-renders on every keystroke in the search box.
const COLUMNS = patientColumns();

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "deceased", label: "Deceased" },
];

export default function PatientsPage() {
  return (
    <Suspense fallback={<Loading label="Loading patients">{null}</Loading>}>
      <PatientsFromSearch />
    </Suspense>
  );
}

/** The top bar search opens this page with ?search=; a new search starts a fresh list. */
function PatientsFromSearch() {
  const search = useSearchParams().get("search") ?? "";
  return <PatientsScreen key={search} initialQuery={search} />;
}

function PatientsScreen({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const permissions = usePermissions();

  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("all");
  const [allergyOnly, setAllergyOnly] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useDebounced(query.trim(), 300);
  const filters = (status !== "all" ? 1 : 0) + (allergyOnly ? 1 : 0);
  const searching = q !== "" || filters > 0;

  const list = useQuery({
    queryKey: ["patients", { q, status, allergyOnly, sort, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/patients/patients/", {
          params: {
            query: {
              q: q || undefined,
              status: status === "all" ? undefined : status,
              allergy: allergyOnly ? "true" : undefined,
              ordering: toOrdering(sort),
              page,
              page_size: String(pageSize),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  // Registrations held as possible duplicates, for the roles that review them.
  const reviewer = permissions.hasRole("front_desk", "doctor", "tenant_admin");
  const reviews = useQuery({
    queryKey: ["duplicate-reviews", "pending"],
    queryFn: () =>
      unwrap(
        api.GET("/api/patients/duplicate-reviews/", { params: { query: { status: "pending" } } }),
      ),
    enabled: reviewer,
    retry: false,
  });
  const pending = reviews.data?.count ?? 0;

  const canRegister = permissions.hasRole("doctor", "nurse", "front_desk");
  const registering = params.get("new") === "1" && canRegister;

  function setRegistering(open: boolean) {
    const next = new URLSearchParams(params.toString());
    if (open) next.set("new", "1");
    else next.delete("new");
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname);
  }

  /** Any change to what is listed starts again from the first page. */
  function restart<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
      setSelected(new Set());
    };
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setAllergyOnly(false);
    setPage(1);
  }

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="the patient register" asPage />;
  }

  const rows = list.data?.results;
  const total = list.data?.count ?? 0;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Patients</h1>
        {list.data && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {total} {total === 1 ? "patient" : "patients"}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {pending > 0 && (
            <Link
              href="/registrations"
              className={cx(
                "rounded-pill text-small flex items-center gap-1.5 bg-amber-tint px-3 py-1.5 font-semibold text-amber-text",
                FOCUS_RING,
              )}
            >
              <UsersThree aria-hidden size={16} weight="fill" />
              {pending} to review
              <span className="sr-only"> in Duplicate review</span>
            </Link>
          )}
          {canRegister && (
            <Button icon={Plus} onClick={() => setRegistering(true)}>
              New patient
            </Button>
          )}
        </div>
      </header>

      <section
        aria-label="Patient register"
        className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
      >
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SearchPill
            variant="table"
            label="Search patients by name, MRN or phone"
            placeholder="Search by name, MRN or phone"
            className="w-full sm:w-80"
            value={query}
            onChange={(e) => restart(setQuery)(e.target.value)}
          />
          <Popover
            title="Filters"
            trigger={
              <Button variant="neutral" icon={SlidersHorizontal}>
                {filters > 0 ? `Filters (${filters})` : "Filters"}
              </Button>
            }
          >
            <div className="flex flex-col gap-4">
              <Select
                label="Status"
                value={status}
                onValueChange={restart(setStatus)}
                options={STATUS_OPTIONS}
              />
              <label className="text-body text-ink-900 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={allergyOnly}
                  onChange={(e) => restart(setAllergyOnly)(e.target.checked)}
                  className={cx("size-4 accent-blue-600", FOCUS_RING)}
                />
                Only patients with a recorded allergy
              </label>
              {filters > 0 && (
                <div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStatus("all");
                      setAllergyOnly(false);
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          </Popover>
        </div>

        {selected.size > 0 && (
          <div className="text-small bg-blue-50 flex items-center gap-3 px-4 py-2">
            <span className="text-ink-900 tnum font-semibold">{selected.size} selected</span>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        )}

        <DataTable
          caption="Patients"
          columns={COLUMNS}
          rows={rows}
          rowId={(p) => p.id}
          rowLabel={(p) => `${p.first_name} ${p.last_name}`}
          refreshing={list.isPlaceholderData}
          error={list.isError}
          onRetry={() => list.refetch()}
          sort={sort}
          onSortChange={restart(setSort)}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          actions={(patient) => (
            <PatientActions
              patient={patient}
              onOpen={(id) => router.push(`/patients/${id}`)}
              onCopyMrn={(mrn) => {
                navigator.clipboard
                  ?.writeText(mrn)
                  .then(() => toast({ title: "MRN copied", description: mrn, tone: "success" }))
                  .catch(() => toast({ title: "Could not copy the MRN", tone: "error" }));
              }}
            />
          )}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: (next) => {
              setPage(next);
              setSelected(new Set());
            },
            onPageSizeChange: restart(setPageSize),
          }}
          empty={
            <EmptyState
              title={searching ? "No patients match your search." : "No patients registered yet."}
              action={
                searching ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear search and filters
                  </Button>
                ) : canRegister ? (
                  <Button icon={Plus} onClick={() => setRegistering(true)}>
                    New patient
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </section>

      <RegistrationWizard
        open={registering}
        onOpenChange={setRegistering}
        canRecordAllergies={permissions.hasRole("doctor", "nurse", "pharmacist")}
      />
    </>
  );
}
