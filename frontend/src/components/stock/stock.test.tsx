import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StockPage from "@/app/(app)/pharmacy/stock/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import {
  ORD_CANCELLED,
  ORD_COMPLETE,
  ORD_PARTIAL,
  ORD_PENDING,
  resetStockMocks,
  stock,
} from "@/mocks/stock";

// Tables, a summary and dialogs are several queries each: allow for a slow, busy host.
vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/pharmacy/stock",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Who = "pharmacist" | "admin" | "finance" | "doctor";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  pharmacist: { signedIn: "pita.pharmacist", me: MOCK_USERS["pita.pharmacist"] },
  admin: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  finance: { signedIn: "femi.finance", me: MOCK_USERS["femi.finance"] },
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
};

function renderPage(who: Who = "pharmacist", search = "") {
  nav.search = search;
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <StockPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  resetStockMocks();
});

const REF = (id: string) => `PO-${id.slice(0, 8).toUpperCase()}`;
const inventory = () => screen.findByRole("table", { name: "Inventory" });
const orders = () => screen.findByRole("table", { name: "Orders" });
const rowIn = (table: HTMLElement, text: string) =>
  within(table).getByText(text).closest("tr") as HTMLElement;

describe("stock header and inventory", () => {
  it("shows the asset value, product count and the in-stock, low and out bar", async () => {
    renderPage();
    const overview = await screen.findByRole("region", { name: "Overview" });
    await waitFor(() => expect(overview).toHaveTextContent("₦52,000.00"));
    expect(overview).toHaveTextContent("Total asset value");
    expect(overview).toHaveTextContent("Products");
    const bar = within(overview).getByRole("figure", { name: "Drugs by stock level" });
    expect(bar).toHaveTextContent("In stock1");
    expect(bar).toHaveTextContent("Low stock2");
    expect(bar).toHaveTextContent("Out of stock1");
  });

  it("lists each drug with its level, units, units on order and value", async () => {
    renderPage();
    const table = await inventory();
    expect(rowIn(table, "Methyldopa 250 mg")).toHaveTextContent("In stock");
    expect(rowIn(table, "Methyldopa 250 mg")).toHaveTextContent("₦50,000.00");
    const low = rowIn(table, "Amoxicillin 500 mg");
    expect(low).toHaveTextContent("Low");
    expect(low).toHaveTextContent("12");
    expect(low).toHaveTextContent("100"); // already on order
    expect(rowIn(table, "Ibuprofen 400 mg")).toHaveTextContent("Out");
  });

  it("offers an Order link only for drugs that need stock, opening the order wizard on that drug", async () => {
    renderPage();
    const table = await inventory();
    expect(within(table).queryByRole("link", { name: /Order Methyldopa/ })).toBeNull();
    expect(within(table).getByRole("link", { name: "Order Ibuprofen 400 mg" })).toHaveAttribute(
      "href",
      "/pharmacy/stock?tab=orders&order=drug3",
    );
  });

  it("searches and filters by stock level", async () => {
    renderPage();
    await inventory();
    await userEvent.type(screen.getByLabelText(/Search the inventory/), "amox");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    await userEvent.clear(screen.getByLabelText(/Search the inventory/));
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Stock level" }));
    await userEvent.click(await screen.findByRole("option", { name: "Out of stock" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByText("Ibuprofen 400 mg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
  });

  it("explains an empty search and clears it", async () => {
    renderPage();
    await inventory();
    await userEvent.type(screen.getByLabelText(/Search the inventory/), "zzzz");
    expect(await screen.findByText("No drugs match your search.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(await screen.findByText("Methyldopa 250 mg")).toBeInTheDocument();
  });
});

describe("the Order Stock tab", () => {
  it("lists orders with items, total, vendor, status, progress and whether the vendor was emailed", async () => {
    renderPage("pharmacist", "tab=orders");
    const table = await orders();
    const pending = rowIn(table, REF(ORD_PENDING));
    expect(pending).toHaveTextContent("3 items • ₦25,000.00");
    expect(pending).toHaveTextContent("MedSupply Ltd");
    expect(pending).toHaveTextContent("Pending");
    expect(within(pending).getByText(/Email sent/)).toBeInTheDocument();

    const partial = rowIn(table, REF(ORD_PARTIAL));
    expect(partial).toHaveTextContent("Partially received");
    expect(
      within(partial).getByRole("progressbar", { name: `Units received for ${REF(ORD_PARTIAL)}` }),
    ).toHaveAttribute("aria-valuetext", "40 of 120");

    const complete = rowIn(table, REF(ORD_COMPLETE));
    expect(complete).toHaveTextContent("Complete");
    expect(within(complete).getByText("Not emailed")).toBeInTheDocument();
  });

  it("disables Receive for a complete or cancelled order", async () => {
    renderPage("pharmacist", "tab=orders");
    const table = await orders();
    expect(
      within(rowIn(table, REF(ORD_COMPLETE))).getByRole("button", { name: /^Receive/ }),
    ).toBeDisabled();
    expect(
      within(rowIn(table, REF(ORD_CANCELLED))).getByRole("button", { name: /^Receive/ }),
    ).toBeDisabled();
    expect(
      within(rowIn(table, REF(ORD_PENDING))).getByRole("button", { name: /^Receive/ }),
    ).toBeEnabled();
  });

  it("searches by vendor or order number and filters by status", async () => {
    renderPage("pharmacist", "tab=orders");
    await orders();
    await userEvent.type(screen.getByLabelText(/Search orders/), "walk-in");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByText(REF(ORD_COMPLETE))).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Search orders/));
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Order status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Cancelled" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByText(REF(ORD_CANCELLED))).toBeInTheDocument();
  });
});

describe("receiving stock, in part and in full", () => {
  async function openReceive(id: string) {
    const table = await orders();
    await userEvent.click(within(rowIn(table, REF(id))).getByRole("button", { name: /^Receive/ }));
    return screen.findByRole("dialog", { name: "Receive stock" });
  }

  async function fill(
    dialog: HTMLElement,
    drug: string,
    values: { qty?: string; batch?: string; expiry?: string },
  ) {
    if (values.qty !== undefined) {
      const box = within(dialog).getByLabelText(`Quantity received, ${drug}`);
      await userEvent.clear(box);
      if (values.qty) await userEvent.type(box, values.qty);
    }
    if (values.batch) {
      await userEvent.type(within(dialog).getByLabelText(`Batch number, ${drug}`), values.batch);
    }
    if (values.expiry) {
      await userEvent.type(within(dialog).getByLabelText(`Expiry date, ${drug}`), values.expiry);
    }
  }

  it("a part delivery raises the progress and marks the order Partially received", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openReceive(ORD_PENDING);
    // Only the first item arrived, and only 40 of its 100.
    await fill(dialog, "Amoxicillin 500 mg", { qty: "40", batch: "AMX-1", expiry: "2030-01-31" });
    await fill(dialog, "Ibuprofen 400 mg", { qty: "" });
    await fill(dialog, "Warfarin 5 mg", { qty: "" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive stock" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Receive stock" })).toBeNull());
    expect(stock.calls.at(-1)).toMatchObject({
      path: "receive",
      body: { receipts: [{ quantity: 40, batch_number: "AMX-1", expiry_date: "2030-01-31" }] },
    });
    const row = rowIn(await orders(), REF(ORD_PENDING));
    await waitFor(() => expect(row).toHaveTextContent("Partially received"));
    expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "40 of 180");
    expect(within(row).getByRole("button", { name: /^Receive/ })).toBeEnabled();
  });

  it("receiving the rest completes the order and disables Receive", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openReceive(ORD_PARTIAL);
    // The partly received order expects 60 more of the first item and 20 of the second.
    expect(within(dialog).getByLabelText("Quantity received, Methyldopa 250 mg")).toHaveValue("60");
    expect(within(dialog).getByLabelText("Quantity received, Amoxicillin 500 mg")).toHaveValue(
      "20",
    );
    await fill(dialog, "Methyldopa 250 mg", { batch: "MET-9", expiry: "2030-02-28" });
    await fill(dialog, "Amoxicillin 500 mg", { batch: "AMX-2", expiry: "2030-03-31" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive stock" }));

    const row = rowIn(await orders(), REF(ORD_PARTIAL));
    await waitFor(() => expect(row).toHaveTextContent("Complete"));
    expect(within(row).getByRole("button", { name: /^Receive/ })).toBeDisabled();
  });

  it("received units join the inventory and the header", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openReceive(ORD_PENDING);
    await fill(dialog, "Ibuprofen 400 mg", { batch: "IBU-1", expiry: "2030-01-31" });
    await fill(dialog, "Amoxicillin 500 mg", { qty: "" });
    await fill(dialog, "Warfarin 5 mg", { qty: "" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive stock" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Receive stock" })).toBeNull());

    // 50 Ibuprofen at ₦100.00 each: out of stock becomes in stock, and the value rises.
    const overview = screen.getByRole("region", { name: "Overview" });
    await waitFor(() => expect(overview).toHaveTextContent("₦57,000.00"));
    expect(
      within(overview).getByRole("figure", { name: "Drugs by stock level" }),
    ).toHaveTextContent("Out of stock0");
  });

  it("refuses more than is still expected, and a missing batch or expiry, before anything is sent", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openReceive(ORD_PENDING);
    await fill(dialog, "Amoxicillin 500 mg", { qty: "101", batch: "AMX-1", expiry: "2030-01-31" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive stock" }));
    expect(await within(dialog).findByText("Only 100 still expected.")).toBeInTheDocument();
    // Ibuprofen and Warfarin default to everything expected but have no batch or expiry.
    expect(within(dialog).getAllByText("Enter the batch number.").length).toBeGreaterThan(0);
    expect(stock.calls.filter((c) => c.path === "receive")).toHaveLength(0);
  });

  it("asks for at least one quantity", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openReceive(ORD_PENDING);
    for (const drug of ["Amoxicillin 500 mg", "Ibuprofen 400 mg", "Warfarin 5 mg"]) {
      await fill(dialog, drug, { qty: "" });
    }
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive stock" }));
    expect(
      await within(dialog).findByText("Enter the quantity received for at least one item."),
    ).toBeInTheDocument();
  });
});

describe("placing an order", () => {
  async function openWizard() {
    await userEvent.click(await screen.findByRole("button", { name: "Order Stock" }));
    return screen.findByRole("dialog", { name: "Order stock" });
  }

  async function chooseDrug(dialog: HTMLElement, name: string) {
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Drug" }));
    await userEvent.click(await screen.findByRole("option", { name }));
  }

  it("takes a vendor, items and a review, then emails the order and lists it first", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openWizard();

    await userEvent.click(within(dialog).getByRole("combobox", { name: "Vendor" }));
    await userEvent.click(await screen.findByRole("option", { name: "MedSupply Ltd" }));
    expect(
      within(dialog).getByText(/emailed to orders@medsupply.example.test/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    await chooseDrug(dialog, "Warfarin 5 mg (Tablet)");
    await userEvent.type(within(dialog).getByLabelText("Quantity"), "100");
    await userEvent.type(within(dialog).getByLabelText(/Unit cost/), "150");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add item" }));
    const items = within(dialog).getByRole("list", { name: "Items on this order" });
    expect(items).toHaveTextContent("100 × ₦150.00");
    expect(items).toHaveTextContent("₦15,000.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).getByTestId("order-total")).toHaveTextContent("₦15,000.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Place order" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Order stock" })).toBeNull());
    expect(stock.calls.find((c) => c.path === "place")?.body).toMatchObject({
      vendor: expect.any(String),
      lines: [{ drug: "drug4", quantity: 100, unit_cost_minor: 15_000 }],
    });
    expect(await screen.findByText(/was emailed to MedSupply Ltd/)).toBeInTheDocument();
    const table = await orders();
    await waitFor(() =>
      expect(within(table).getAllByRole("row")[1]).toHaveTextContent("1 item • ₦15,000.00"),
    );
  });

  it("will not move on without a vendor or without items, and checks each item field", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openWizard();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("Choose a vendor, or add one.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("combobox", { name: "Vendor" }));
    await userEvent.click(await screen.findByRole("option", { name: "Walk-in Supplier" }));
    expect(within(dialog).getByText(/no email address/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("Add at least one item.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Add item" }));
    expect(await within(dialog).findByText("Choose a drug.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Enter a whole number of units, such as 100."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a price such as 150.00.")).toBeInTheDocument();
  });

  it("adds a new vendor and picks it", async () => {
    renderPage("pharmacist", "tab=orders");
    const dialog = await openWizard();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add a vendor" }));
    await userEvent.type(within(dialog).getByLabelText("Vendor name"), "Prime Pharma");
    await userEvent.type(within(dialog).getByLabelText(/Vendor email/), "sales@prime.example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save vendor" }));
    expect(
      await within(dialog).findByText(/emailed to sales@prime.example.test/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Vendor" })).toHaveTextContent(
      "Prime Pharma",
    );
  });

  it("opens on the drug from a low-stock link", async () => {
    renderPage("pharmacist", "tab=orders&order=drug3");
    const dialog = await screen.findByRole("dialog", { name: "Order stock" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Vendor" }));
    await userEvent.click(await screen.findByRole("option", { name: "MedSupply Ltd" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox", { name: "Drug" })).toHaveValue(
        "Ibuprofen 400 mg (Tablet)",
      ),
    );
  });
});

describe("cancelling an order", () => {
  it("cancels an order nothing has arrived on, after confirming", async () => {
    renderPage("pharmacist", "tab=orders");
    const table = await orders();
    await userEvent.click(
      within(rowIn(table, REF(ORD_PENDING))).getByRole("button", {
        name: `Actions for order ${REF(ORD_PENDING)}`,
      }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel order" }));
    const confirm = await screen.findByRole("dialog", { name: "Cancel this order?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(rowIn(table, REF(ORD_PENDING))).toHaveTextContent("Cancelled"));
  });

  it("does not offer to cancel an order that has been partly received", async () => {
    renderPage("pharmacist", "tab=orders");
    const table = await orders();
    await userEvent.click(
      within(rowIn(table, REF(ORD_PARTIAL))).getByRole("button", {
        name: `Actions for order ${REF(ORD_PARTIAL)}`,
      }),
    );
    expect(await screen.findByRole("menuitem", { name: "Cancel order" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("who sees what", () => {
  it("shows the tenant admin everything but no way to order or receive", async () => {
    renderPage("admin", "tab=orders");
    const table = await orders();
    expect(screen.queryByRole("button", { name: "Order Stock" })).toBeNull();
    expect(within(table).queryByRole("button", { name: /^Receive/ })).toBeNull();
    expect(await screen.findByRole("region", { name: "Overview" })).toBeInTheDocument();
  });

  it("shows finance the orders but not the inventory or the stock totals", async () => {
    renderPage("finance");
    await orders();
    expect(screen.queryByRole("tab", { name: "Inventory" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Overview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Order Stock" })).toBeNull();
  });

  it("tells a doctor they have no access", async () => {
    renderPage("doctor");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
