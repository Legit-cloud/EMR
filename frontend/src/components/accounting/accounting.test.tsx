import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountingPage from "@/app/(app)/accounting/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { canReverse, checkDraft, draftTotals } from "@/lib/accounting";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { accountingHandlers, entries, resetAccountingMocks } from "@/mocks/accounting";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { server } from "@/mocks/server";

vi.setConfig({ testTimeout: 90_000 });

function renderPage(who = "femi.finance") {
  resetAuthMocks(who);
  server.use(...accountingHandlers);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={MOCK_USERS[who]}>
            <AccountingPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetAccountingMocks);

describe("entry rules", () => {
  const line = (account: string, debit = "", credit = "") => ({ account, debit, credit });

  it("adds up what is typed and says when it balances", () => {
    expect(draftTotals([line("5300", "1500.50"), line("1000", "", "1500.50")])).toEqual({
      debit: 150050,
      credit: 150050,
      balanced: true,
    });
    expect(draftTotals([line("5300", "10"), line("1000", "", "5")]).balanced).toBe(false);
  });

  it("refuses an unbalanced, one-sided or incomplete entry", () => {
    expect(checkDraft([line("5300", "10")])).toHaveProperty(
      "error",
      "An entry needs at least two lines.",
    );
    expect(checkDraft([line("5300", "10"), line("", "", "10")])).toHaveProperty(
      "error",
      "Choose an account on every line.",
    );
    expect(checkDraft([line("5300", "10", "10"), line("1000", "", "10")])).toHaveProperty("error");
    expect(checkDraft([line("5300", "10"), line("1000", "", "9")])).toHaveProperty(
      "error",
      "Debits and credits must be equal.",
    );
    expect(checkDraft([line("5300", "ten"), line("1000", "", "10")])).toHaveProperty("error");
  });

  it("returns minor units for a balanced entry", () => {
    expect(checkDraft([line("5300", "10.00"), line("1000", "", "10.00")])).toEqual({
      lines: [
        { account: "5300", debit_minor: 1000, credit_minor: 0 },
        { account: "1000", debit_minor: 0, credit_minor: 1000 },
      ],
    });
  });

  it("lets only manual entries be reversed", () => {
    expect(canReverse({ source: "manual" })).toBe(true);
    expect(canReverse({ source: "invoice" })).toBe(false);
  });
});

describe("accounting screen", () => {
  it("lists entries and posts a balanced manual entry", async () => {
    renderPage();
    expect(await screen.findByText("Consultation delivered")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = await screen.findByRole("dialog", { name: "New ledger entry" });
    await userEvent.type(within(dialog).getByLabelText("Description"), "Generator fuel");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Account, line 1" }));
    await userEvent.click(await screen.findByRole("option", { name: "5300 Utilities and rent" }));
    await userEvent.type(within(dialog).getByLabelText("Debit, line 1"), "5000");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Account, line 2" }));
    await userEvent.click(await screen.findByRole("option", { name: "1000 Cash on hand" }));
    await userEvent.type(within(dialog).getByLabelText("Credit, line 2"), "5000");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Balanced");
    await userEvent.click(within(dialog).getByRole("button", { name: "Post entry" }));
    await screen.findByText("Entry posted");
    expect(entries.at(-1)?.description).toBe("Generator fuel");
  });

  it("will not post an unbalanced entry", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New entry" }));
    const dialog = await screen.findByRole("dialog", { name: "New ledger entry" });
    await userEvent.type(within(dialog).getByLabelText("Description"), "Test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Post entry" }));
    expect(
      await within(dialog).findByText("An entry needs at least two lines."),
    ).toBeInTheDocument();
    expect(entries).toHaveLength(1);
  });

  it("shows the reports", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "Income statement" }));
    expect(await screen.findByText("Net profit")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Balance sheet" }));
    expect(await screen.findByText("Profit to date")).toBeInTheDocument();
  });

  it("shows the tenant admin the books without posting buttons", async () => {
    renderPage("bisi.finance");
    await screen.findByText("Consultation delivered");
    expect(screen.queryByRole("button", { name: "New entry" })).toBeNull();
  });

  it("does not offer to reverse an entry that came from an invoice", async () => {
    renderPage();
    await screen.findByText("Consultation delivered");
    expect(screen.queryByRole("button", { name: /^Reverse/ })).toBeNull();
  });
});
