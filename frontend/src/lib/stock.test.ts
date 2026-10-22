import { describe, expect, it } from "vitest";

import { STOCK_SERIES } from "./chart-colours";
import { formatMoney } from "./money";
import { ORDER_STATUS, STOCK_LEVEL, TONES } from "./status-map";
import {
  canCancel,
  canReceive,
  checkQuantity,
  checkReceipt,
  checkUnitCost,
  itemsText,
  lineTotal,
  orderTotal,
  outstanding,
  stockHref,
  toOrdering,
} from "./stock";

describe("order money", () => {
  it("multiplies in integers, with nothing lost to rounding", () => {
    expect(lineTotal(100, 15_000)).toBe(1_500_000);
    expect(lineTotal(3, 3_333)).toBe(9_999);
    expect(lineTotal(1_000_000, 99_999_999)).toBe(99_999_999_000_000);
  });

  it("totals an order's items", () => {
    const items = [
      { quantity: 100, unitCostMinor: 15_000 },
      { quantity: 50, unitCostMinor: 8_000 },
    ];
    expect(orderTotal(items)).toBe(1_900_000);
    expect(formatMoney(orderTotal(items), "NGN")).toBe("₦19,000.00");
    expect(orderTotal([])).toBe(0);
  });
});

describe("what is typed when ordering", () => {
  it("takes a whole number of units", () => {
    expect(checkQuantity("100")).toEqual({ quantity: 100 });
    expect(checkQuantity(" 7 ")).toEqual({ quantity: 7 });
    for (const text of ["", "abc", "1.5", "-3"]) {
      expect(checkQuantity(text)).toEqual({ error: "Enter a whole number of units, such as 100." });
    }
    expect(checkQuantity("0")).toEqual({ error: "The quantity must be at least 1." });
    expect(checkQuantity("1000001")).toEqual({
      error: "That is more than can be ordered at once.",
    });
  });

  it("takes a unit cost to the kobo and never zero", () => {
    expect(checkUnitCost("150", "NGN")).toEqual({ minor: 15_000 });
    expect(checkUnitCost("1,250.50", "NGN")).toEqual({ minor: 125_050 });
    expect(checkUnitCost("0.01", "NGN")).toEqual({ minor: 1 });
    expect(checkUnitCost("0", "NGN")).toEqual({ error: "The price must be more than zero." });
    expect(checkUnitCost("1.005", "NGN")).toEqual({ error: "Enter a price such as 150.00." });
    expect(checkUnitCost("abc", "NGN")).toEqual({ error: "Enter a price such as 150.00." });
  });
});

describe("receiving a delivery", () => {
  const TODAY = "2026-10-21";
  const full = { quantity: "40", batch: " B-17 ", expiry: "2028-01-31" };

  it("accepts any quantity up to what is still expected", () => {
    expect(checkReceipt(full, 60, TODAY)).toEqual({
      quantity: 40,
      batch: "B-17",
      expiry: "2028-01-31",
    });
    expect(checkReceipt({ ...full, quantity: "60" }, 60, TODAY)).toMatchObject({ quantity: 60 });
    expect(checkReceipt({ ...full, quantity: "1" }, 60, TODAY)).toMatchObject({ quantity: 1 });
  });

  it("skips a line when nothing arrived", () => {
    expect(checkReceipt({ ...full, quantity: "" }, 60, TODAY)).toEqual({ skip: true });
    expect(checkReceipt({ ...full, quantity: "0" }, 60, TODAY)).toEqual({ skip: true });
  });

  it("refuses more than is expected, naming how many are", () => {
    expect(checkReceipt({ ...full, quantity: "61" }, 60, TODAY)).toEqual({
      error: "Only 60 still expected.",
      field: "quantity",
    });
  });

  it("needs a batch number and an expiry date in the future", () => {
    expect(checkReceipt({ ...full, batch: "  " }, 60, TODAY)).toEqual({
      error: "Enter the batch number.",
      field: "batch",
    });
    expect(checkReceipt({ ...full, expiry: "" }, 60, TODAY)).toEqual({
      error: "Enter the expiry date.",
      field: "expiry",
    });
    for (const expiry of ["2026-10-21", "2026-01-01"]) {
      expect(checkReceipt({ ...full, expiry }, 60, TODAY)).toEqual({
        error: "The expiry date must be in the future.",
        field: "expiry",
      });
    }
  });

  it("works out what is left after a partial delivery", () => {
    expect(outstanding({ quantity_ordered: 100, quantity_received: 40 })).toBe(60);
    expect(outstanding({ quantity_ordered: 100, quantity_received: 100 })).toBe(0);
  });
});

describe("what can be done to an order", () => {
  it("receives while anything is still expected and cancels only an untouched order", () => {
    expect(canReceive({ status: "pending" })).toBe(true);
    expect(canReceive({ status: "partially_received" })).toBe(true);
    expect(canReceive({ status: "complete" })).toBe(false);
    expect(canReceive({ status: "cancelled" })).toBe(false);
    expect(canCancel({ status: "pending" })).toBe(true);
    expect(canCancel({ status: "partially_received" })).toBe(false);
  });
});

describe("links, sorting and wording", () => {
  it("links to the stock screen, on a tab or with a drug to order", () => {
    expect(stockHref()).toBe("/pharmacy/stock");
    expect(stockHref({ tab: "orders" })).toBe("/pharmacy/stock?tab=orders");
    expect(stockHref({ tab: "orders", order: "abc" })).toBe("/pharmacy/stock?tab=orders&order=abc");
  });

  it("maps table sorting to the API's names", () => {
    expect(toOrdering(null)).toBeUndefined();
    expect(toOrdering({ key: "total", direction: "desc" })).toBe("-total");
    expect(toOrdering({ key: "vendor", direction: "asc" })).toBe("vendor");
    expect(toOrdering({ key: "email", direction: "asc" })).toBeUndefined();
  });

  it("counts items", () => {
    expect(itemsText(1)).toBe("1 item");
    expect(itemsText(3)).toBe("3 items");
  });
});

describe("colours come from the status map", () => {
  it("gives every order status a label and keeps the stock bar in step with the pills", () => {
    expect(ORDER_STATUS.pending.label).toBe("Pending");
    expect(ORDER_STATUS.partially_received.label).toBe("Partially received");
    expect(ORDER_STATUS.complete.label).toBe("Complete");
    expect(ORDER_STATUS.complete.tone).toBe("green");
    expect(STOCK_LEVEL.low.tone).toBe("amber");
    expect(STOCK_LEVEL.out.tone).toBe("pink");
    expect(TONES[STOCK_LEVEL.in_stock.tone].dot).toBeTruthy();
    expect(STOCK_SERIES.low).toBe("bg-chart-expense");
  });
});
