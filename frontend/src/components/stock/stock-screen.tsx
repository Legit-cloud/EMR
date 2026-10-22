"use client";

import { Copy, Prohibit, Plus, SlidersHorizontal, Tray } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DataTable, type Sort } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KebabMenu } from "@/components/ui/menu";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import { SearchPill } from "@/components/ui/search-pill";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import {
  canCancel,
  canReceive,
  type OrderRow,
  refusalMessage,
  stockHref,
  useCancelOrder,
  useInventory,
  useOrders,
  useStockSummary,
} from "@/lib/stock";
import { useDebounced } from "@/lib/use-debounced";

import { OrderWizard } from "./order-wizard";
import { ReceiveDialog } from "./receive-dialog";
import { SummaryCard } from "./summary-card";
import { inventoryColumns, orderColumns } from "./tables";

const LEVEL_OPTIONS = [
  { value: "all", label: "All levels" },
  { value: "in_stock", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
];

const ORDER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "partially_received", label: "Partially received" },
  { value: "complete", label: "Complete" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Pharmacy stock: the totals header, then Inventory and Order Stock tabs. The tab and the
 * "order this drug" shortcut live in the address, so low-stock links elsewhere open here.
 */
export function StockScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const permissions = usePermissions();
  const summary = useStockSummary();

  const canOrder = permissions.hasRole("pharmacist");
  const tab = params.get("tab") === "orders" ? "orders" : "inventory";
  const orderParam = params.get("order");
  const [wizardOpen, setWizardOpen] = useState(orderParam !== null && canOrder);
  const [receiveId, setReceiveId] = useState<string | null>(null);

  function closeWizard(open: boolean) {
    setWizardOpen(open);
    if (!open && params.get("order") !== null) {
      router.replace(stockHref({ tab: "orders" }), { scroll: false });
    }
  }

  const refused = summary.error instanceof ApiRequestError && summary.error.status === 403;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Stocks</h1>
        {canOrder && (
          <Button
            icon={Plus}
            className="ml-auto"
            onClick={() => {
              setWizardOpen(true);
            }}
          >
            Order Stock
          </Button>
        )}
      </header>

      {refused && !permissions.hasRole("finance") ? (
        <NoAccess what="pharmacy stock" asPage />
      ) : (
        <>
          {!refused && <SummaryCard summary={summary.data} error={summary.isError} />}
          <Tabs
            label="Stock"
            value={refused ? "orders" : tab}
            onValueChange={(value) =>
              router.replace(stockHref({ tab: value as "inventory" | "orders" }), {
                scroll: false,
              })
            }
            items={[
              ...(refused
                ? []
                : [
                    {
                      value: "inventory",
                      label: "Inventory",
                      content: <InventoryTab canOrder={canOrder} />,
                    },
                  ]),
              {
                value: "orders",
                label: "Order Stock",
                content: <OrdersTab canOrder={canOrder} onReceive={setReceiveId} />,
              },
            ]}
          />
        </>
      )}

      {canOrder && (
        <OrderWizard
          open={wizardOpen}
          onOpenChange={closeWizard}
          initialDrug={orderParam && orderParam !== "new" ? orderParam : null}
        />
      )}
      <ReceiveDialog orderId={receiveId} onOpenChange={(open) => !open && setReceiveId(null)} />
    </>
  );
}

// -- Inventory --------------------------------------------------------------------------------

function InventoryTab({ canOrder }: { canOrder: boolean }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const q = useDebounced(query.trim(), 300);
  const list = useInventory({ q, status: level, page, pageSize });
  const columns = useMemo(() => inventoryColumns(canOrder), [canOrder]);

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="the inventory" compact />;
  }
  const filters = level !== "all" ? 1 : 0;
  const searching = q !== "" || filters > 0;
  const restart =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  return (
    <section
      aria-label="Inventory"
      className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <SearchPill
          variant="table"
          label="Search the inventory by drug name"
          placeholder="Search by drug name"
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
          <Select
            label="Stock level"
            value={level}
            onValueChange={restart(setLevel)}
            options={LEVEL_OPTIONS}
          />
        </Popover>
      </div>
      <DataTable
        caption="Inventory"
        columns={columns}
        rows={list.data?.results}
        rowId={(row) => row.id}
        refreshing={list.isPlaceholderData}
        error={list.isError}
        onRetry={() => list.refetch()}
        pagination={{
          page,
          pageSize,
          total: list.data?.count ?? 0,
          onPageChange: setPage,
          onPageSizeChange: restart(setPageSize),
        }}
        empty={
          <EmptyState
            title={searching ? "No drugs match your search." : "No drugs on the formulary yet."}
            action={
              searching ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setLevel("all");
                    setPage(1);
                  }}
                >
                  Clear search and filters
                </Button>
              ) : undefined
            }
          />
        }
      />
    </section>
  );
}

// -- Order Stock ------------------------------------------------------------------------------

function OrdersTab({
  canOrder,
  onReceive,
}: {
  canOrder: boolean;
  onReceive: (id: string) => void;
}) {
  const toast = useToast();
  const cancel = useCancelOrder();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const q = useDebounced(query.trim(), 300);
  const list = useOrders({ q, status, sort, page, pageSize });
  const filters = status !== "all" ? 1 : 0;
  const searching = q !== "" || filters > 0;

  const columns = useMemo(
    () =>
      orderColumns((row) =>
        canOrder ? (
          <Button
            variant="outline"
            disabled={!canReceive(row)}
            aria-label={`Receive ${row.reference}`}
            onClick={() => onReceive(row.id)}
          >
            Receive
          </Button>
        ) : null,
      ),
    [canOrder, onReceive],
  );

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="stock orders" compact />;
  }
  const restart =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  async function confirmCancel() {
    if (!cancelling) return;
    try {
      await cancel.mutateAsync(cancelling.id);
      toast({ title: "Order cancelled", description: cancelling.reference, tone: "success" });
      setCancelling(null);
      setProblem(null);
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <section
      aria-label="Orders"
      className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <SearchPill
          variant="table"
          label="Search orders by order number or vendor"
          placeholder="Search by order number or vendor"
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
          <Select
            label="Order status"
            value={status}
            onValueChange={restart(setStatus)}
            options={ORDER_OPTIONS}
          />
        </Popover>
      </div>
      <DataTable
        caption="Orders"
        columns={columns}
        rows={list.data?.results}
        rowId={(row) => row.id}
        refreshing={list.isPlaceholderData}
        error={list.isError}
        onRetry={() => list.refetch()}
        sort={sort}
        onSortChange={restart(setSort)}
        actions={(row) => (
          <KebabMenu
            label={`Actions for order ${row.reference}`}
            items={[
              ...(canOrder
                ? [
                    {
                      label: "Receive stock",
                      icon: Tray,
                      disabled: !canReceive(row),
                      onSelect: () => onReceive(row.id),
                    },
                    {
                      label: "Cancel order",
                      icon: Prohibit,
                      disabled: !canCancel(row),
                      onSelect: () => setCancelling(row),
                    },
                  ]
                : []),
              {
                label: "Copy order number",
                icon: Copy,
                onSelect: () => {
                  navigator.clipboard
                    ?.writeText(row.reference)
                    .then(() =>
                      toast({
                        title: "Order number copied",
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
          total: list.data?.count ?? 0,
          onPageChange: setPage,
          onPageSizeChange: restart(setPageSize),
        }}
        empty={
          <EmptyState
            title={searching ? "No orders match your search." : "No stock orders yet."}
            action={
              searching ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    setPage(1);
                  }}
                >
                  Clear search and filters
                </Button>
              ) : undefined
            }
          />
        }
      />
      <Modal
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelling(null);
            setProblem(null);
          }
        }}
        title="Cancel this order?"
        description={
          cancelling ? `${cancelling.reference} to ${cancelling.vendor_name}` : undefined
        }
        size="confirm"
        footer={
          <ModalFooter
            start={
              <Button variant="ghost" onClick={() => setCancelling(null)}>
                Keep order
              </Button>
            }
            end={
              <Button loading={cancel.isPending} onClick={confirmCancel}>
                Cancel order
              </Button>
            }
          />
        }
      >
        <div className="flex flex-col gap-3">
          {problem && <Banner tone="danger" live title={problem} />}
          <p className="text-body text-ink-600">
            Nothing has been received on it. The vendor has already been emailed, so tell them too.
          </p>
        </div>
      </Modal>
    </section>
  );
}
