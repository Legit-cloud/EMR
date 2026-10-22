"use client";

import { Bell, Copy, Receipt, ShieldCheck, SlidersHorizontal } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Button } from "@/components/ui/button";
import { DataTable, type Sort } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus";
import { LinkButton } from "@/components/ui/link-button";
import { KebabMenu } from "@/components/ui/menu";
import { Popover } from "@/components/ui/popover";
import { SearchPill } from "@/components/ui/search-pill";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  invoiceHref,
  type InvoiceRow,
  refusalMessage,
  reminderBlock,
  useInvoiceList,
  useInvoiceSummary,
  useSendReminder,
} from "@/lib/billing";
import { cx } from "@/lib/cx";
import { usePermissions } from "@/lib/permissions";
import { useDebounced } from "@/lib/use-debounced";

import { InvoiceDrawer } from "./invoice-drawer";
import { invoiceColumns } from "./invoice-table";
import { SummaryCard } from "./summary-card";

// Built once: the table re-renders on every keystroke in the search box.
const COLUMNS = invoiceColumns();

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
];

/**
 * Invoices: totals header, a searchable table with payment-status pills, and the invoice
 * drawer. The open invoice lives in the address (?invoice=), so a link opens it directly.
 */
export function BillingScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const permissions = usePermissions();
  const remind = useSendReminder();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [estateOnly, setEstateOnly] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const q = useDebounced(query.trim(), 300);
  const filters = (status !== "all" ? 1 : 0) + (estateOnly ? 1 : 0);
  const searching = q !== "" || filters > 0;

  const list = useInvoiceList({ q, status, estateReview: estateOnly, sort, page, pageSize });
  const summary = useInvoiceSummary(q);

  // Billing officers take the money; the other roles with access only look.
  const canCollect = permissions.hasRole("billing_officer");
  const canSeeInsurers = permissions.hasRole(
    "billing_officer",
    "tenant_admin",
    "front_desk",
    "finance",
  );
  const openId = params.get("invoice");

  function closeDrawer() {
    router.replace(pathname, { scroll: false });
  }

  function restart<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setEstateOnly(false);
    setPage(1);
  }

  async function sendReminder(row: InvoiceRow) {
    try {
      await remind.mutateAsync(row.id);
      toast({ title: "Reminder sent", description: row.patient_name, tone: "success" });
    } catch (failure) {
      toast({ title: "Reminder not sent", description: refusalMessage(failure), tone: "error" });
    }
  }

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="invoices" asPage />;
  }

  const rows = list.data?.results;
  const total = list.data?.count ?? 0;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Billing</h1>
        {list.data && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {total} {total === 1 ? "invoice" : "invoices"}
          </span>
        )}
        {canSeeInsurers && (
          <LinkButton
            variant="outline"
            icon={ShieldCheck}
            href="/billing/insurers"
            className="ml-auto"
          >
            Insurers
          </LinkButton>
        )}
      </header>

      <SummaryCard summary={summary.data} error={summary.isError} />

      <section
        aria-label="Invoices"
        className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
      >
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SearchPill
            variant="table"
            label="Search invoices by patient, MRN or invoice number"
            placeholder="Search by patient, MRN or invoice number"
            className="w-full sm:w-96"
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
                label="Payment status"
                value={status}
                onValueChange={restart(setStatus)}
                options={STATUS_OPTIONS}
              />
              <label className="text-body text-ink-900 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={estateOnly}
                  onChange={(e) => restart(setEstateOnly)(e.target.checked)}
                  className={cx("size-4 accent-blue-600", FOCUS_RING)}
                />
                Only invoices held for estate review
              </label>
              {filters > 0 && (
                <div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStatus("all");
                      setEstateOnly(false);
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

        <DataTable
          caption="Invoices"
          columns={COLUMNS}
          rows={rows}
          rowId={(row) => row.id}
          refreshing={list.isPlaceholderData}
          error={list.isError}
          onRetry={() => list.refetch()}
          sort={sort}
          onSortChange={restart(setSort)}
          actions={(row) => (
            <KebabMenu
              label={`Actions for invoice ${row.reference}`}
              items={[
                {
                  label: "Open invoice",
                  icon: Receipt,
                  onSelect: () => router.push(invoiceHref(row.id), { scroll: false }),
                },
                ...(canCollect
                  ? [
                      {
                        label: "Send reminder",
                        icon: Bell,
                        disabled: reminderBlock(row) !== null,
                        onSelect: () => void sendReminder(row),
                      },
                    ]
                  : []),
                {
                  label: "Copy invoice number",
                  icon: Copy,
                  onSelect: () => {
                    navigator.clipboard
                      ?.writeText(row.reference)
                      .then(() =>
                        toast({
                          title: "Invoice number copied",
                          description: row.reference,
                          tone: "success",
                        }),
                      )
                      .catch(() => toast({ title: "Could not copy the number", tone: "error" }));
                  },
                },
              ]}
            />
          )}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: restart(setPageSize),
          }}
          empty={
            <EmptyState
              title={searching ? "No invoices match your search." : "No invoices yet."}
              action={
                searching ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear search and filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </section>

      <InvoiceDrawer invoiceId={openId} onClose={closeDrawer} canCollect={canCollect} />
    </>
  );
}
