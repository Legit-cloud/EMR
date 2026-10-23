import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CataloguePage from "@/app/(app)/diagnostics/catalogue/page";
import DiagnosticsPage from "@/app/(app)/diagnostics/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { orderActions } from "@/lib/diagnostics";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { diagnostics, resetDiagnosticsMocks } from "@/mocks/diagnostics";

vi.setConfig({ testTimeout: 90_000 });

type Who = "doctor" | "tech" | "admin" | "billing";
const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
  tech: { signedIn: "kemi.lab", me: MOCK_USERS["kemi.lab"] },
  admin: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  billing: { signedIn: "ngozi.billing", me: MOCK_USERS["ngozi.billing"] },
};

function renderPage(page: React.ReactNode, who: Who) {
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>{page}</SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetDiagnosticsMocks);

const table = () => screen.findByRole("table", { name: "Orders" });
const rowOf = (t: HTMLElement, text: string) =>
  within(t).getByText(text).closest("tr") as HTMLElement;

describe("tests and scans", () => {
  it("lists what is waiting, with who ordered it and how it reads", async () => {
    renderPage(<DiagnosticsPage />, "tech");
    const t = await table();
    expect(rowOf(t, "Tolu Okafor")).toHaveTextContent("Full blood count");
    expect(rowOf(t, "Bisi Lawal")).toHaveTextContent("Chest X-ray");
    // Resulted orders are not "waiting".
    expect(within(t).queryByText("Chidi Nwosu")).toBeNull();
  });

  it("shows resulted orders with the value and that a doctor has yet to review it", async () => {
    renderPage(<DiagnosticsPage />, "doctor");
    await table();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Resulted" }));
    const row = await waitFor(() =>
      rowOf(screen.getByRole("table", { name: "Orders" }), "Chidi Nwosu"),
    );
    expect(row).toHaveTextContent("10.2 g/dL");
    expect(row).toHaveTextContent("Abnormal");
    expect(row).toHaveTextContent("Waiting for a doctor to review");
  });

  it("lets a technician mark the sample taken", async () => {
    renderPage(<DiagnosticsPage />, "tech");
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Tolu Okafor")).getByRole("button", {
        name: "Mark the sample taken for Tolu Okafor",
      }),
    );
    await waitFor(() =>
      expect(diagnostics.calls.map((c) => c.path)).toContain("orders/ord-01/collect"),
    );
    expect(await screen.findByText("Marked as taken")).toBeInTheDocument();
  });

  it("asks for a value before saving a laboratory result, then records it", async () => {
    renderPage(<DiagnosticsPage />, "tech");
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Tolu Okafor")).getByRole("button", {
        name: "Enter the result for Tolu Okafor",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Enter the result" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save result" }));
    expect(await within(dialog).findByText("Enter the value.")).toBeInTheDocument();
    expect(diagnostics.calls).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText("Value"), "13.4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save result" }));
    await waitFor(() => expect(diagnostics.calls).toHaveLength(1));
    expect(diagnostics.calls[0].body).toMatchObject({
      order: "ord-01",
      value: "13.4",
      flag: "normal",
    });
    expect(await screen.findByText("Result recorded")).toBeInTheDocument();
  });

  it("asks for findings on an imaging result", async () => {
    renderPage(<DiagnosticsPage />, "tech");
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Bisi Lawal")).getByRole("button", {
        name: "Enter the result for Bisi Lawal",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Enter the result" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save result" }));
    expect(
      await within(dialog).findByText("Write the findings and impression."),
    ).toBeInTheDocument();
  });

  it("lets a doctor review a result", async () => {
    renderPage(<DiagnosticsPage />, "doctor");
    await table();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Resulted" }));
    const button = await screen.findByRole("button", { name: "Review the result for Chidi Nwosu" });
    await userEvent.click(button);
    await waitFor(() =>
      expect(diagnostics.calls.map((c) => c.path)).toContain("results/res-03/review"),
    );
    expect(await screen.findByText("Result reviewed")).toBeInTheDocument();
  });

  it("cancels an order with a reason", async () => {
    renderPage(<DiagnosticsPage />, "doctor");
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Tolu Okafor")).getByRole("button", {
        name: "Cancel the order for Tolu Okafor",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Cancel this order" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    expect(await within(dialog).findByText("Say why it is cancelled.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Ordered in error");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() =>
      expect(diagnostics.calls[0]).toMatchObject({
        path: "orders/ord-01/cancel",
        body: { reason: "Ordered in error" },
      }),
    );
  });

  it("offers ordering only to a doctor", async () => {
    const { unmount } = renderPage(<DiagnosticsPage />, "doctor");
    expect(await screen.findByRole("button", { name: "Order a test or scan" })).toBeInTheDocument();
    unmount();
    renderPage(<DiagnosticsPage />, "tech");
    await table();
    expect(screen.queryByRole("button", { name: "Order a test or scan" })).toBeNull();
  });

  it("tells someone who may not see orders that they have no access", async () => {
    renderPage(<DiagnosticsPage />, "billing");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
  });
});

describe("test catalogue", () => {
  it("lists the catalogue with prices, and lets the administrator add to it", async () => {
    renderPage(<CataloguePage />, "admin");
    const t = await screen.findByRole("table", { name: "Catalogue" });
    expect(within(t).getByText("Full blood count").closest("tr")).toHaveTextContent("₦4,500.00");
    await userEvent.click(screen.getByRole("button", { name: "Add a test or scan" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a test or scan" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter the name.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Name"), "Malaria test");
    await userEvent.type(within(dialog).getByLabelText("Price (naira)"), "1500");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(diagnostics.calls[0]).toMatchObject({
        path: "investigations",
        body: { name: "Malaria test", price_minor: 150_000, kind: "lab" },
      }),
    );
  });

  it("does not offer editing to a technician", async () => {
    renderPage(<CataloguePage />, "tech");
    await screen.findByRole("table", { name: "Catalogue" });
    expect(screen.queryByRole("button", { name: "Add a test or scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
  });
});

describe("orderActions", () => {
  const base = {
    status: "ordered",
    current_result: null,
  } as unknown as Schemas["DiagnosticOrder"];
  it("gives each role only its own steps", () => {
    expect(orderActions(base, ["lab_technician"])).toMatchObject({ collect: true, record: true });
    expect(orderActions(base, ["doctor"])).toMatchObject({ cancel: true, record: false });
    expect(orderActions(base, ["nurse"])).toMatchObject({ cancel: false, record: false });
    const resulted = {
      status: "resulted",
      current_result: { is_reviewed: false },
    } as unknown as Schemas["DiagnosticOrder"];
    expect(orderActions(resulted, ["doctor"])).toMatchObject({ review: true, correct: false });
    expect(orderActions(resulted, ["lab_technician"])).toMatchObject({
      review: false,
      correct: true,
    });
  });
});
