import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BillingPage from "@/app/(app)/billing/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import {
  billing,
  HMO,
  INV_ESTATE,
  INV_INSURED,
  INV_LOCKED,
  INV_PAID,
  INV_PART,
  INV_UNPAID,
  resetBillingMocks,
} from "@/mocks/billing";
import { resetChartMocks } from "@/mocks/chart";

// A table, a summary and a drawer are several queries each: allow for a slow, busy host.
vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/billing",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Who = "billing" | "admin" | "doctor";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  billing: { signedIn: "ngozi.billing", me: MOCK_USERS["ngozi.billing"] },
  admin: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
};

function renderPage(who: Who = "billing", invoice?: string) {
  nav.search = invoice ? `invoice=${invoice}` : "";
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <BillingPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  resetBillingMocks();
  resetChartMocks();
});

const table = () => screen.findByRole("table", { name: "Invoices" });

/** The patients' names in row order. */
function patients() {
  return within(screen.getByRole("table", { name: "Invoices" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent ?? "");
}

const rowOf = (text: string) =>
  within(screen.getByRole("table", { name: "Invoices" }))
    .getByText(text)
    .closest("tr") as HTMLElement;

async function openDrawer(reference: string) {
  return screen.findByRole("dialog", { name: `Invoice ${reference}` });
}

const REF = (id: string) => `INV-${id.slice(0, 8).toUpperCase()}`;

describe("billing screen (mock layer)", () => {
  it("shows the totals header and every invoice with its payment pill", async () => {
    renderPage();
    await table();
    expect(screen.getByText("6 invoices")).toBeInTheDocument();

    const overview = await screen.findByRole("region", { name: "Overview" });
    await waitFor(() => expect(overview).toHaveTextContent("₦88,300.00"));
    expect(overview).toHaveTextContent("₦20,000.00");
    expect(overview).toHaveTextContent("₦68,300.00");
    const bar = within(overview).getByRole("figure", { name: "Invoices by payment status" });
    expect(bar).toHaveTextContent("Paid1");
    expect(bar).toHaveTextContent("Partly paid2");
    expect(bar).toHaveTextContent("Unpaid3");

    const first = rowOf("Tolu Okafor");
    expect(first).toHaveTextContent("INV-1A5E2F8C");
    expect(first).toHaveTextContent("2 items • ₦10,300.00");
    expect(first).toHaveTextContent("Unpaid");
    expect(rowOf("Bisi Lawal")).toHaveTextContent("Partially paid");
    expect(rowOf("Chidi Nwosu")).toHaveTextContent("Paid");
    expect(rowOf("Ife Adeyemi")).toHaveTextContent("Estate review");
    expect(patients()[0]).toContain("Tolu Okafor"); // newest first
  });

  it("searches by patient, and the totals follow the search", async () => {
    renderPage();
    await table();
    await userEvent.type(screen.getByLabelText(/Search invoices/), "bisi");
    await waitFor(() => expect(screen.getByText("1 invoice")).toBeInTheDocument());
    expect(patients()).toHaveLength(1);
    const overview = screen.getByRole("region", { name: "Overview" });
    await waitFor(() => expect(overview).toHaveTextContent("₦8,000.00"));
    expect(overview).not.toHaveTextContent("₦88,300.00");
  });

  it("finds an invoice by the start of its number", async () => {
    renderPage();
    await table();
    await userEvent.type(screen.getByLabelText(/Search invoices/), "#INV-4A5E");
    await waitFor(() => expect(patients()).toEqual([expect.stringContaining("Ngozi Eze")]));
  });

  it("filters by payment status and shows what filter is on", async () => {
    renderPage();
    await table();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Payment status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Paid" }));
    await waitFor(() => expect(screen.getByText("1 invoice")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
    expect(patients()).toEqual([expect.stringContaining("Chidi Nwosu")]);
  });

  it("sorts by the total owed, largest first", async () => {
    renderPage();
    await table();
    const header = screen.getByRole("button", { name: "Total" });
    await userEvent.click(header);
    await userEvent.click(header);
    await waitFor(() => expect(patients()[0]).toContain("Amina Bello"));
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("says when nothing matches, with a way out", async () => {
    renderPage();
    await table();
    await userEvent.type(screen.getByLabelText(/Search invoices/), "nobody at all");
    expect(await screen.findByText("No invoices match your search.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => expect(screen.getByText("6 invoices")).toBeInTheDocument());
  });

  it("opens an invoice from its link or its menu, and closes back to the list", async () => {
    renderPage();
    await table();
    const link = within(rowOf("Tolu Okafor")).getByRole("link", {
      name: /Open invoice INV-1A5E2F8C/,
    });
    expect(link).toHaveAttribute("href", `/billing?invoice=${INV_UNPAID}`);

    await userEvent.click(within(rowOf("Bisi Lawal")).getByRole("button", { name: /Actions for/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Open invoice" }));
    expect(nav.push).toHaveBeenCalledWith(`/billing?invoice=${INV_PART}`, { scroll: false });
  });

  it("refuses a role without invoice access", async () => {
    renderPage("doctor");
    expect(await screen.findByText(/You do not have access to invoices/)).toBeInTheDocument();
  });
});

describe("invoice drawer", () => {
  it("shows each charge with its source tag, and the totals with what is still due", async () => {
    renderPage("billing", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    const charges = await within(drawer).findByRole("region", { name: "Charges" });
    expect(charges).toHaveTextContent("Consultation");
    expect(charges).toHaveTextContent("Service");
    expect(charges).toHaveTextContent("Paracetamol 500 mg");
    expect(charges).toHaveTextContent("Prescription");
    expect(charges).toHaveTextContent("Pending");
    expect(within(drawer).getByTestId("payment-status")).toHaveTextContent("Unpaid");
    expect(within(drawer).getByText("Tolu Okafor")).toBeInTheDocument();
    expect(within(drawer).getByTestId("total")).toHaveTextContent("₦10,300.00");
    expect(within(drawer).getByTestId("paid")).toHaveTextContent("₦0.00");
    expect(within(drawer).getByTestId("net-due")).toHaveTextContent("₦10,300.00");
  });

  it("splits a bill between the insurer and the patient", async () => {
    renderPage("billing", INV_INSURED);
    const drawer = await openDrawer(REF(INV_INSURED));
    expect(await within(drawer).findByText(/Synthetic HMO · 80%/)).toBeInTheDocument();
    expect(within(drawer).getByTestId("insurer-due")).toHaveTextContent("₦16,000.00");
    expect(within(drawer).getByTestId("patient-due")).toHaveTextContent("₦4,000.00");
  });

  it("lists the payments received", async () => {
    renderPage("billing", INV_PART);
    const drawer = await openDrawer(REF(INV_PART));
    await userEvent.click(await within(drawer).findByRole("tab", { name: "Payments" }));
    const payments = await within(drawer).findByRole("region", { name: "Payments" });
    expect(payments).toHaveTextContent("Cash");
    expect(payments).toHaveTextContent("ref POS-1");
    expect(payments).toHaveTextContent("₦5,000.00");
  });

  it("takes a part payment and shows what is still due", async () => {
    renderPage("billing", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Take payment" }));
    const pay = await screen.findByRole("dialog", { name: "Take payment" });
    const amount = within(pay).getByLabelText(/^Amount/);
    expect(amount).toHaveValue("10300.00");
    await userEvent.clear(amount);
    await userEvent.type(amount, "5000");
    await userEvent.type(within(pay).getByLabelText(/^Reference/), "POS-4471");
    await userEvent.click(within(pay).getByRole("button", { name: "Record payment" }));

    await waitFor(() =>
      expect(within(drawer).getByTestId("net-due")).toHaveTextContent("₦5,300.00"),
    );
    expect(within(drawer).getByTestId("payment-status")).toHaveTextContent("Partially paid");
    expect(within(drawer).getByTestId("paid")).toHaveTextContent("₦5,000.00");
    const sent = billing.calls.find((c) => c.path === "pay")!
      .body as Schemas["PaymentRequestRequest"];
    expect(sent).toMatchObject({
      payer: "patient",
      method: "cash",
      amount_minor: 500_000,
      reference: "POS-4471",
    });
    expect(sent.idempotency_key).toBeTruthy();
  });

  it("takes the rest, and the invoice becomes paid with no more actions", async () => {
    renderPage("billing", INV_PART);
    const drawer = await openDrawer(REF(INV_PART));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Take payment" }));
    const pay = await screen.findByRole("dialog", { name: "Take payment" });
    expect(within(pay).getByLabelText(/^Amount/)).toHaveValue("3000.00");
    await userEvent.click(within(pay).getByRole("button", { name: "Record payment" }));
    await waitFor(() =>
      expect(within(drawer).getByTestId("payment-status")).toHaveTextContent("Paid"),
    );
    expect(within(drawer).getByTestId("net-due")).toHaveTextContent("₦0.00");
    expect(within(drawer).queryByRole("button", { name: "Take payment" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Add charge" })).not.toBeInTheDocument();
  });

  it("will not take more than the payer owes, and says how much they owe", async () => {
    renderPage("billing", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Take payment" }));
    const pay = await screen.findByRole("dialog", { name: "Take payment" });
    const amount = within(pay).getByLabelText(/^Amount/);
    await userEvent.clear(amount);
    await userEvent.type(amount, "20000");
    await userEvent.click(within(pay).getByRole("button", { name: "Record payment" }));
    expect(
      await within(pay).findByText("The patient owes ₦10,300.00. Refunds are handled separately."),
    ).toBeInTheDocument();
    expect(billing.calls.some((c) => c.path === "pay")).toBe(false);
  });

  it("lets the insurer pay its share by remittance", async () => {
    renderPage("billing", INV_INSURED);
    const drawer = await openDrawer(REF(INV_INSURED));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Take payment" }));
    const pay = await screen.findByRole("dialog", { name: "Take payment" });
    await userEvent.click(within(pay).getByRole("combobox", { name: "Paid by" }));
    await userEvent.click(await screen.findByRole("option", { name: "Insurer" }));
    expect(within(pay).getByLabelText(/^Amount/)).toHaveValue("16000.00");
    expect(within(pay).getByRole("combobox", { name: "Method" })).toHaveTextContent(
      "Insurer remittance",
    );
    await userEvent.click(within(pay).getByRole("button", { name: "Record payment" }));
    await waitFor(() =>
      expect(within(drawer).getByTestId("payment-status")).toHaveTextContent("Partially paid"),
    );
    expect(billing.calls.find((c) => c.path === "pay")!.body).toMatchObject({
      payer: "insurer",
      method: "insurer_remittance",
      amount_minor: 1_600_000,
    });
  });

  it("changes the insurer's share before anything is delivered or paid", async () => {
    renderPage("billing", INV_INSURED);
    const drawer = await openDrawer(REF(INV_INSURED));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Insurer coverage" }));
    const dialog = await screen.findByRole("dialog", { name: "Insurer coverage" });
    const percent = within(dialog).getByLabelText("Insurer pays (%)");
    expect(percent).toHaveValue("80");
    await userEvent.clear(percent);
    await userEvent.type(percent, "50");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save coverage" }));
    await waitFor(() =>
      expect(within(drawer).getByTestId("insurer-due")).toHaveTextContent("₦10,000.00"),
    );
    expect(within(drawer).getByTestId("patient-due")).toHaveTextContent("₦10,000.00");
    expect(billing.calls.find((c) => c.path === "coverage")!.body).toEqual({
      insurer: HMO.id,
      coverage_bp: 5_000,
    });
  });

  it("explains that coverage is fixed once money has been received", async () => {
    renderPage("billing", INV_LOCKED);
    const drawer = await openDrawer(REF(INV_LOCKED));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Insurer coverage" }));
    const dialog = await screen.findByRole("dialog", { name: "Insurer coverage" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save coverage" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Coverage is fixed");
  });

  it("adds a manual charge for a service already given", async () => {
    renderPage("billing", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Add charge" }));
    const dialog = await screen.findByRole("dialog", { name: "Add charge" });
    await userEvent.type(within(dialog).getByLabelText("Description"), "Registration card");
    await userEvent.type(within(dialog).getByLabelText(/^Unit price/), "2000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add charge" }));
    await waitFor(() =>
      expect(within(drawer).getByTestId("total")).toHaveTextContent("₦12,300.00"),
    );
    expect(within(drawer).getByTestId("net-due")).toHaveTextContent("₦12,300.00");
    expect(billing.calls.find((c) => c.path === "charge")!.body).toMatchObject({
      description: "Registration card",
      quantity: 1,
      unit_price_minor: 200_000,
      delivered: true,
    });
  });

  it("sends a payment reminder, and refuses a second one straight away", async () => {
    renderPage("billing", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Send Reminder" }));
    expect(await screen.findByText("Reminder sent")).toBeInTheDocument();
    expect(screen.getByText("SMS and Email")).toBeInTheDocument();
    await within(drawer).findByText(/Last reminder sent/);

    await userEvent.click(within(drawer).getByRole("button", { name: "Send Reminder" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent(
      "A reminder was sent recently",
    );
  });

  it("reports a patient with no phone or email on file", async () => {
    renderPage("billing", INV_PART);
    const drawer = await openDrawer(REF(INV_PART));
    await userEvent.click(await within(drawer).findByRole("button", { name: "Send Reminder" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent(
      "no phone number or email on file",
    );
  });

  it("offers no reminder for a paid invoice or one held for estate review", async () => {
    const { unmount } = renderPage("billing", INV_PAID);
    let drawer = await openDrawer(REF(INV_PAID));
    expect(await within(drawer).findByRole("button", { name: "Send Reminder" })).toBeDisabled();
    expect(within(drawer).getByText("Nothing is due on this invoice.")).toBeInTheDocument();
    unmount();

    renderPage("billing", INV_ESTATE);
    drawer = await openDrawer(REF(INV_ESTATE));
    expect(await within(drawer).findByRole("button", { name: "Send Reminder" })).toBeDisabled();
    expect(within(drawer).getByText("Held for estate settlement review")).toBeInTheDocument();
    expect(within(drawer).getByText("Estate review", { selector: "span" })).toBeInTheDocument();
  });

  it("lets a role without billing rights look but not change", async () => {
    renderPage("admin", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    expect(
      await within(drawer).findByText(/can view this invoice but not change it/),
    ).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Take payment" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Send Reminder" })).not.toBeInTheDocument();
    expect(within(drawer).getByTestId("net-due")).toHaveTextContent("₦10,300.00");
  });

  it("closes back to the list", async () => {
    renderPage("billing", INV_UNPAID);
    const drawer = await openDrawer(REF(INV_UNPAID));
    await userEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(nav.replace).toHaveBeenCalledWith("/billing", { scroll: false });
  });
});
