import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";
import { lineTotal } from "@/lib/stock";

import { mockSignedIn } from "./auth";
import { DRUGS } from "./pharmacy";

/**
 * Pharmacy stock and orders, shaped like apps/pharmacy, with the rules the screen relies on:
 * a delivery cannot exceed what is still expected, an order is Partially received until every
 * line has arrived, only an untouched order can be cancelled, and received units join the
 * inventory. Synthetic data; all money is integer kobo.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Line = Mutable<Schemas["OrderLine"]>;
type OrderEntry = Omit<Mutable<Schemas["Order"]>, "lines" | "receipts"> & {
  lines: Line[];
  receipts: Schemas["OrderReceipt"][];
};
type Row = Mutable<Schemas["InventoryRow"]>;

export const VENDOR_MED = { id: "v1000000-0000-4000-8000-000000000001", name: "MedSupply Ltd" };
export const VENDOR_QUIET = {
  id: "v1000000-0000-4000-8000-000000000002",
  name: "Walk-in Supplier",
};

export const ORD_PENDING = "01a00000-0000-4000-8000-000000000001";
export const ORD_PARTIAL = "02a00000-0000-4000-8000-000000000002";
export const ORD_COMPLETE = "03a00000-0000-4000-8000-000000000003";
export const ORD_CANCELLED = "04a00000-0000-4000-8000-000000000004";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

type State = {
  vendors: Schemas["Vendor"][];
  inventory: Row[];
  orders: OrderEntry[];
  /** Requests received, for assertions. */
  calls: { path: string; body: unknown }[];
  next: number;
  forbidden: boolean;
};

let counter = 0;

function inventoryRow(
  index: number,
  available: number,
  reorder: number,
  onOrder = 0,
  price = 10_000,
): Row {
  const drug = DRUGS[index];
  return {
    id: drug.id,
    name: drug.name,
    brand_name: "",
    strength: drug.strength,
    form: drug.form,
    unit_price_minor: price,
    currency: "NGN",
    reorder_level: reorder,
    available,
    on_order: onOrder,
    value_minor: available * price,
    stock_status: available <= 0 ? "out" : available <= reorder ? "low" : "in_stock",
  };
}

function orderLine(
  order: string,
  drugIndex: number,
  ordered: number,
  received: number,
  cost: number,
): Line {
  const drug = DRUGS[drugIndex];
  return {
    id: `ol-${order.slice(0, 2)}-${++counter}`,
    drug: drug.id,
    drug_name: `${drug.name} ${drug.strength}`,
    quantity_ordered: ordered,
    quantity_received: received,
    unit_cost_minor: cost,
    total_minor: lineTotal(ordered, cost),
  };
}

function build(
  id: string,
  vendor: { id: string; name: string },
  hours: number,
  lines: Line[],
  options: { status?: Schemas["PurchaseOrderStatusEnum"]; emailed?: boolean } = {},
): OrderEntry {
  const entry: OrderEntry = {
    id,
    reference: `PO-${id.slice(0, 8).toUpperCase()}`,
    vendor: vendor.id,
    vendor_name: vendor.name,
    status: options.status ?? "pending",
    currency: "NGN",
    note: "",
    email_sent_at: options.emailed === false ? null : hoursAgo(hours),
    line_count: 0,
    units_ordered: 0,
    units_received: 0,
    total_minor: 0,
    created_at: hoursAgo(hours),
    lines,
    receipts: [],
  };
  refresh(entry);
  return entry;
}

/** The order's counts and status from its lines, like the server's annotations. */
function refresh(order: OrderEntry): void {
  order.line_count = order.lines.length;
  order.units_ordered = order.lines.reduce((sum, l) => sum + l.quantity_ordered, 0);
  order.units_received = order.lines.reduce((sum, l) => sum + l.quantity_received, 0);
  order.total_minor = order.lines.reduce((sum, l) => sum + l.total_minor, 0);
  if (order.status === "cancelled") return;
  order.status =
    order.units_received === 0
      ? "pending"
      : order.lines.every((l) => l.quantity_received >= l.quantity_ordered)
        ? "complete"
        : "partially_received";
}

function seeded(): State {
  const inventory = [
    inventoryRow(0, 500, 20),
    inventoryRow(1, 12, 20, 100),
    inventoryRow(2, 0, 20),
    inventoryRow(3, 8, 20),
  ];
  const orders = [
    build(ORD_PENDING, VENDOR_MED, 3, [
      orderLine(ORD_PENDING, 1, 100, 0, 15_000),
      orderLine(ORD_PENDING, 2, 50, 0, 8_000),
      orderLine(ORD_PENDING, 3, 30, 0, 20_000),
    ]),
    build(ORD_PARTIAL, VENDOR_MED, 30, [
      orderLine(ORD_PARTIAL, 0, 100, 40, 5_000),
      orderLine(ORD_PARTIAL, 1, 20, 0, 15_000),
    ]),
    build(ORD_COMPLETE, VENDOR_QUIET, 60, [orderLine(ORD_COMPLETE, 0, 200, 200, 5_000)], {
      emailed: false,
    }),
    build(ORD_CANCELLED, VENDOR_MED, 90, [orderLine(ORD_CANCELLED, 2, 10, 0, 9_000)], {
      status: "cancelled",
    }),
  ];
  return {
    vendors: [
      {
        ...VENDOR_MED,
        email: "orders@medsupply.example.test",
        phone: "+2348000000000",
        active: true,
      },
      { ...VENDOR_QUIET, email: "", phone: "", active: true },
    ],
    inventory,
    orders,
    calls: [],
    next: 1,
    forbidden: false,
  };
}

export const stock: State = seeded();

export function resetStockMocks(): void {
  counter = 100;
  Object.assign(stock, seeded());
}

export const orderOf = (id: string) => stock.orders.find((o) => o.id === id);

// -- handlers ---------------------------------------------------------------------------------

const failure = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const STOCK_VIEWERS = ["pharmacist", "tenant_admin"];
const ORDER_VIEWERS = ["pharmacist", "tenant_admin", "finance"];

/** 401, 403 or null when the signed-in user may view (or, with `write`, change) this data. */
function refusal(allowed: string[]) {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  return me.roles.some((r) => allowed.includes(r))
    ? null
    : failure(403, "permission_denied", "You do not have permission.");
}

const paged = <T>(url: URL, all: T[]) => {
  const size = Number(url.searchParams.get("page_size") ?? 25);
  const page = Number(url.searchParams.get("page") ?? 1);
  return HttpResponse.json({
    count: all.length,
    next: null,
    previous: null,
    results: all.slice((page - 1) * size, page * size),
  });
};

function summary(): Schemas["StockSummary"] {
  const rows = stock.inventory;
  const level = (status: Row["stock_status"]) => rows.filter((r) => r.stock_status === status);
  return {
    currency: "NGN",
    value_minor: rows.reduce((sum, r) => sum + r.value_minor, 0),
    products: rows.length,
    in_stock: level("in_stock").length,
    low: level("low").length,
    out: level("out").length,
    low_items: [...level("out"), ...level("low")].slice(0, 5).map((r) => ({
      drug: r.id,
      name: `${r.name} ${r.strength}`,
      available: r.available,
      reorder_level: r.reorder_level,
    })),
  };
}

function listRow(order: OrderEntry): Schemas["OrderList"] {
  return {
    id: order.id,
    reference: order.reference,
    vendor: order.vendor,
    vendor_name: order.vendor_name,
    status: order.status,
    currency: order.currency,
    note: order.note,
    email_sent_at: order.email_sent_at,
    line_count: order.line_count,
    units_ordered: order.units_ordered,
    units_received: order.units_received,
    total_minor: order.total_minor,
    created_at: order.created_at,
  };
}

const ORDER_KEY = {
  created: "created_at",
  status: "status",
  total: "total_minor",
  vendor: "vendor_name",
} as const;

function receiveRefusal(order: OrderEntry, receipts: Schemas["ReceiveRequest"]["receipts"]) {
  const refuse = (message: string) => failure(409, "order_refused", message);
  if (order.status === "complete" || order.status === "cancelled") {
    return refuse(`This order is already ${order.status}.`);
  }
  for (const entry of receipts) {
    const line = order.lines.find((l) => l.id === entry.line);
    if (!line) return refuse("That item is not on this order.");
    const left = line.quantity_ordered - line.quantity_received;
    if (entry.quantity > left) {
      return refuse(`${line.drug_name}: only ${left} still expected, ${entry.quantity} entered.`);
    }
  }
  return null;
}

export const stockHandlers = [
  http.get("*/api/pharmacy/stock/summary/", () => {
    const refused = refusal(STOCK_VIEWERS);
    if (refused) return refused;
    return HttpResponse.json(summary());
  }),

  http.get("*/api/pharmacy/stock/inventory/", ({ request }) => {
    const refused = refusal(STOCK_VIEWERS);
    if (refused) return refused;
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const status = url.searchParams.get("status");
    const found = stock.inventory
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => !status || r.stock_status === status)
      .sort((a, b) => a.name.localeCompare(b.name));
    return paged(url, found);
  }),

  http.get("*/api/pharmacy/vendors/", ({ request }) => {
    const refused = refusal(ORDER_VIEWERS);
    if (refused) return refused;
    const active = new URL(request.url).searchParams.get("active") === "true";
    return HttpResponse.json(stock.vendors.filter((v) => !active || v.active));
  }),

  http.post("*/api/pharmacy/vendors/", async ({ request }) => {
    const refused = refusal(["pharmacist"]);
    if (refused) return refused;
    const body = (await request.json()) as Schemas["VendorRequest"];
    stock.calls.push({ path: "vendor", body });
    if (stock.vendors.some((v) => v.name.toLowerCase() === body.name.toLowerCase())) {
      return failure(400, "validation_error", "Invalid input.", {
        name: ["A vendor with this name already exists."],
      });
    }
    const vendor = {
      id: `v2000000-0000-4000-8000-00000000000${stock.next++}`,
      name: body.name,
      email: body.email ?? "",
      phone: body.phone ?? "",
      active: true,
    };
    stock.vendors.push(vendor);
    return HttpResponse.json(vendor, { status: 201 });
  }),

  http.get("*/api/pharmacy/orders/", ({ request }) => {
    const refused = refusal(ORDER_VIEWERS);
    if (refused) return refused;
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().replace(/^#/, "");
    const status = url.searchParams.get("status");
    const raw = url.searchParams.get("ordering") ?? "-created";
    const key = ORDER_KEY[raw.replace(/^-/, "") as keyof typeof ORDER_KEY] ?? "created_at";
    const sign = raw.startsWith("-") ? -1 : 1;
    const found = stock.orders
      .filter(
        (o) =>
          (!q ||
            o.reference.toLowerCase().includes(q) ||
            o.vendor_name.toLowerCase().includes(q)) &&
          (!status || o.status === status),
      )
      .sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * sign);
    return paged(url, found.map(listRow));
  }),

  http.get("*/api/pharmacy/orders/:id/", ({ params }) => {
    const refused = refusal(ORDER_VIEWERS);
    if (refused) return refused;
    const order = orderOf(String(params.id));
    return order ? HttpResponse.json(order) : failure(404, "not_found", "Not found.");
  }),

  http.post("*/api/pharmacy/orders/place/", async ({ request }) => {
    const refused = refusal(["pharmacist"]);
    if (refused) return refused;
    const body = (await request.json()) as Schemas["PlaceOrderRequest"];
    stock.calls.push({ path: "place", body });
    const vendor = stock.vendors.find((v) => v.id === body.vendor);
    if (!vendor)
      return failure(400, "validation_error", "Invalid input.", { vendor: ["Unknown."] });
    const id = `05a00000-0000-4000-8000-00000000010${stock.next++}`;
    const lines = body.lines.map((l) => {
      const drug = DRUGS.find((d) => d.id === l.drug)!;
      return {
        id: `ol-new-${++counter}`,
        drug: drug.id,
        drug_name: `${drug.name} ${drug.strength}`,
        quantity_ordered: l.quantity,
        quantity_received: 0,
        unit_cost_minor: l.unit_cost_minor,
        total_minor: lineTotal(l.quantity, l.unit_cost_minor),
      };
    });
    const order = build(id, vendor, 0, lines, { emailed: Boolean(vendor.email) });
    order.note = body.note ?? "";
    stock.orders.unshift(order);
    for (const l of lines) {
      const row = stock.inventory.find((r) => r.id === l.drug);
      if (row) row.on_order += l.quantity_ordered;
    }
    return HttpResponse.json(order, { status: 201 });
  }),

  http.post("*/api/pharmacy/orders/:id/receive/", async ({ params, request }) => {
    const refused = refusal(["pharmacist"]);
    if (refused) return refused;
    const order = orderOf(String(params.id));
    if (!order) return failure(404, "not_found", "Not found.");
    const body = (await request.json()) as Schemas["ReceiveRequest"];
    stock.calls.push({ path: "receive", body });
    const wrong = receiveRefusal(order, body.receipts);
    if (wrong) return wrong;
    for (const entry of body.receipts) {
      const line = order.lines.find((l) => l.id === entry.line)!;
      line.quantity_received += entry.quantity;
      const row = stock.inventory.find((r) => r.id === line.drug);
      if (row) {
        row.available += entry.quantity;
        row.on_order = Math.max(row.on_order - entry.quantity, 0);
        row.value_minor = row.available * row.unit_price_minor;
        row.stock_status =
          row.available <= 0 ? "out" : row.available <= row.reorder_level ? "low" : "in_stock";
      }
      order.receipts.unshift({
        id: `rc-${++counter}`,
        line: line.id,
        quantity: entry.quantity,
        batch_number: entry.batch_number,
        expiry_date: entry.expiry_date,
        created_at: new Date().toISOString(),
      });
    }
    refresh(order);
    return HttpResponse.json(order);
  }),

  http.post("*/api/pharmacy/orders/:id/cancel/", ({ params }) => {
    const refused = refusal(["pharmacist"]);
    if (refused) return refused;
    const order = orderOf(String(params.id));
    if (!order) return failure(404, "not_found", "Not found.");
    stock.calls.push({ path: "cancel", body: null });
    if (order.status !== "pending") {
      return failure(409, "order_refused", "Only an order with nothing received can be cancelled.");
    }
    order.status = "cancelled";
    return HttpResponse.json(order);
  }),
];
