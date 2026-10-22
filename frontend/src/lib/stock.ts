import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Sort } from "@/components/ui/data-table";
import { api, apiError, type Schemas, unwrap } from "@/lib/api";
import { sumMinor, toMinor } from "@/lib/money";

export type StockSummary = Schemas["StockSummary"];
export type InventoryRow = Schemas["InventoryRow"];
export type OrderRow = Schemas["OrderList"];
export type Order = Schemas["Order"];
export type OrderLine = Schemas["OrderLine"];
export type Vendor = Schemas["Vendor"];
export type OrderStatus = Schemas["PurchaseOrderStatusEnum"];
export type StockLevel = InventoryRow["stock_status"];

// -- money on an order -------------------------------------------------------------------------

/** Quantity times unit cost in minor units, in integers only. */
export function lineTotal(quantity: number, unitCostMinor: number): number {
  return Number(BigInt(quantity) * BigInt(unitCostMinor));
}

/** The total of a draft order's items. */
export function orderTotal(items: readonly { quantity: number; unitCostMinor: number }[]): number {
  return sumMinor(items.map((item) => lineTotal(item.quantity, item.unitCostMinor)));
}

// -- checking what was typed -------------------------------------------------------------------

export type DraftItem = {
  drug: string;
  name: string;
  quantity: number;
  unitCostMinor: number;
};

/** A whole number of units from 1 to a million, or an error sentence. */
export function checkQuantity(text: string): { quantity: number } | { error: string } {
  const clean = text.trim();
  if (!/^\d+$/.test(clean)) return { error: "Enter a whole number of units, such as 100." };
  const quantity = Number(clean);
  if (quantity < 1) return { error: "The quantity must be at least 1." };
  if (quantity > 1_000_000) return { error: "That is more than can be ordered at once." };
  return { quantity };
}

/** What one unit costs, in minor units. */
export function checkUnitCost(text: string, currency: string) {
  const minor = toMinor(text, currency);
  if (minor === null) return { error: "Enter a price such as 150.00." } as const;
  if (minor < 1) return { error: "The price must be more than zero." } as const;
  return { minor } as const;
}

export type ReceiptEntry = { quantity: string; batch: string; expiry: string };

export type ReceiptCheck =
  | { skip: true }
  | { error: string; field: "quantity" | "batch" | "expiry" }
  | { quantity: number; batch: string; expiry: string };

/**
 * One line of a delivery. A blank quantity means "none of this arrived today" and is skipped;
 * anything else needs a batch number and an expiry date after `today` (YYYY-MM-DD).
 */
export function checkReceipt(
  entry: ReceiptEntry,
  outstanding: number,
  today: string,
): ReceiptCheck {
  if (entry.quantity.trim() === "" || entry.quantity.trim() === "0") return { skip: true };
  const quantity = checkQuantity(entry.quantity);
  if ("error" in quantity) return { error: quantity.error, field: "quantity" };
  if (quantity.quantity > outstanding) {
    return { error: `Only ${outstanding} still expected.`, field: "quantity" };
  }
  if (!entry.batch.trim()) return { error: "Enter the batch number.", field: "batch" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiry)) {
    return { error: "Enter the expiry date.", field: "expiry" };
  }
  if (entry.expiry <= today)
    return { error: "The expiry date must be in the future.", field: "expiry" };
  return { quantity: quantity.quantity, batch: entry.batch.trim(), expiry: entry.expiry };
}

/** Units still expected on a line. */
export const outstanding = (line: Pick<OrderLine, "quantity_ordered" | "quantity_received">) =>
  line.quantity_ordered - line.quantity_received;

/** Whether a delivery can still be booked against the order. */
export const canReceive = (order: Pick<OrderRow, "status">) =>
  order.status === "pending" || order.status === "partially_received";

export const canCancel = (order: Pick<OrderRow, "status">) => order.status === "pending";

/** "5 items": the grey line under the order number. */
export const itemsText = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

/** The address of the stock screen, optionally on a tab or with the order wizard open for a drug. */
export function stockHref(options: { tab?: "inventory" | "orders"; order?: string } = {}) {
  const params = new URLSearchParams();
  if (options.tab) params.set("tab", options.tab);
  if (options.order) params.set("order", options.order);
  const text = params.toString();
  return text ? `/pharmacy/stock?${text}` : "/pharmacy/stock";
}

const ORDERING = { created: "created", status: "status", total: "total", vendor: "vendor" };

/** The table's sort as the API's `ordering` parameter. */
export function toOrdering(sort: Sort | null): string | undefined {
  if (!sort || !(sort.key in ORDERING)) return undefined;
  return `${sort.direction === "desc" ? "-" : ""}${ORDERING[sort.key as keyof typeof ORDERING]}`;
}

// -- queries -----------------------------------------------------------------------------------

export function useStockSummary() {
  return useQuery({
    queryKey: ["stock", "summary"],
    queryFn: () => unwrap(api.GET("/api/pharmacy/stock/summary/")),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export type InventoryFilters = { q: string; status: string; page: number; pageSize: number };

export function useInventory({ q, status, page, pageSize }: InventoryFilters) {
  return useQuery({
    queryKey: ["stock", "inventory", { q, status, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/pharmacy/stock/inventory/", {
          params: {
            query: {
              q: q || undefined,
              status: status === "all" ? undefined : status,
              page,
              page_size: String(pageSize),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export type OrderFilters = {
  q: string;
  status: string;
  sort: Sort | null;
  page: number;
  pageSize: number;
};

export function useOrders({ q, status, sort, page, pageSize }: OrderFilters) {
  return useQuery({
    queryKey: ["stock", "orders", { q, status, sort, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/pharmacy/orders/", {
          params: {
            query: {
              q: q || undefined,
              status: status === "all" ? undefined : status,
              ordering: toOrdering(sort),
              page,
              page_size: String(pageSize),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ["stock", "order", id],
    enabled: id !== null,
    queryFn: () => unwrap(api.GET("/api/pharmacy/orders/{id}/", { params: { path: { id: id! } } })),
    retry: false,
  });
}

export function useVendors() {
  return useQuery({
    queryKey: ["stock", "vendors"],
    queryFn: () => unwrap(api.GET("/api/pharmacy/vendors/")),
    staleTime: 60_000,
  });
}

/** Everything on the screen derives from orders and batches, so any change refreshes all of it. */
export function useRefreshStock() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["stock"] });
}

export function useAddVendor() {
  const refresh = useRefreshStock();
  return useMutation({
    mutationFn: (body: Schemas["VendorRequest"]) =>
      unwrap(api.POST("/api/pharmacy/vendors/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function usePlaceOrder() {
  const refresh = useRefreshStock();
  return useMutation({
    mutationFn: (body: Schemas["PlaceOrderRequest"]) =>
      unwrap(api.POST("/api/pharmacy/orders/place/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useReceiveOrder(id: string) {
  const refresh = useRefreshStock();
  return useMutation({
    mutationFn: (body: Schemas["ReceiveRequest"]) =>
      unwrap(api.POST("/api/pharmacy/orders/{id}/receive/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useCancelOrder() {
  const refresh = useRefreshStock();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/pharmacy/orders/{id}/cancel/", { params: { path: { id } } })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** A sentence for why the server refused a stock action. */
export function refusalMessage(failure: unknown): string {
  const problem = apiError(failure);
  if (problem.code === "validation_error") {
    const first = Object.values(problem.details)[0];
    return Array.isArray(first) ? String(first[0]) : problem.message;
  }
  return problem.message;
}
