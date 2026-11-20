import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

/** General supplies, shaped like apps/inventory (docs/adr/0026). Synthetic data. */
type Item = Schemas["Item"];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function seeded(): Mutable<Item>[] {
  const make = (n: number, name: string, on_hand: number, reorder: number, cost: number) => ({
    id: `item-${n}`,
    sku: `SUP-${100 + n}`,
    name,
    category: "Consumables",
    unit: "box",
    on_hand,
    reorder_level: reorder,
    unit_cost_minor: cost,
    currency: "NGN",
    active: true,
    is_low: on_hand <= reorder,
  });
  return [
    make(1, "Gloves, medium", 40, 10, 250_000),
    make(2, "Syringes 5 ml", 4, 10, 120_000),
    make(3, "Bed linen", 0, 5, 800_000),
  ];
}

export let supplies = seeded();
export const resetInventoryMocks = () => {
  supplies = seeded();
};

const page = <T>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

export const inventoryHandlers = [
  http.get("*/api/inventory/items/summary/", () => {
    const value = supplies.reduce((sum, i) => sum + i.on_hand * (i.unit_cost_minor ?? 0), 0);
    return HttpResponse.json({
      items: supplies.length,
      out: supplies.filter((i) => i.on_hand === 0).length,
      low: supplies.filter((i) => i.on_hand > 0 && i.is_low).length,
      units: supplies.reduce((sum, i) => sum + i.on_hand, 0),
      value_minor: value,
      currency: "NGN",
    });
  }),
  http.get("*/api/inventory/items/", ({ request }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get("search") ?? "").toLowerCase();
    const low = url.searchParams.get("status") === "low";
    return HttpResponse.json(
      page(
        supplies.filter(
          (i) =>
            (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)) &&
            (!low || i.is_low),
        ),
      ),
    );
  }),
  http.post("*/api/inventory/items/", async ({ request }) => {
    const body = (await request.json()) as Schemas["ItemRequest"];
    if (supplies.some((i) => i.sku === body.sku)) {
      return HttpResponse.json(
        {
          error: {
            code: "validation_error",
            message: "Check the form.",
            details: { sku: ["An item with this code already exists."] },
          },
        },
        { status: 400 },
      );
    }
    const item: Mutable<Item> = {
      id: `item-${supplies.length + 1}`,
      unit: "each",
      category: "",
      reorder_level: 0,
      unit_cost_minor: 0,
      currency: "NGN",
      active: true,
      ...body,
      on_hand: 0,
      is_low: true,
    };
    supplies.push(item);
    return HttpResponse.json(item, { status: 201 });
  }),
  http.post("*/api/inventory/movements/", async ({ request }) => {
    const body = (await request.json()) as Schemas["MovementRequestRequest"];
    const item = supplies.find((i) => i.id === body.item);
    if (!item) return HttpResponse.json({}, { status: 404 });
    const delta =
      body.kind === "receive"
        ? body.quantity
        : body.kind === "issue"
          ? -body.quantity
          : body.quantity - item.on_hand;
    if (item.on_hand + delta < 0) {
      return HttpResponse.json(
        {
          error: {
            code: "insufficient_stock",
            message: `Only ${item.on_hand} ${item.unit} of ${item.name} in stock.`,
            details: {},
          },
        },
        { status: 409 },
      );
    }
    item.on_hand += delta;
    item.is_low = item.on_hand <= (item.reorder_level ?? 0);
    return HttpResponse.json(
      {
        id: `mv-${Date.now()}`,
        item: item.id,
        kind: body.kind,
        quantity: delta,
        balance_after: item.on_hand,
        department: null,
        reason: body.reason,
        created_at: new Date().toISOString(),
        created_by: null,
      },
      { status: 201 },
    );
  }),
];
