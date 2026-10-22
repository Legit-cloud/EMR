import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuditPage from "@/app/(app)/admin/audit/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { activeFilters, isBreakGlass, NO_FILTERS, toQuery } from "@/lib/audit";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { auditMock, resetAuditMocks } from "@/mocks/audit";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";

vi.setConfig({ testTimeout: 90_000 });

type Who = "admin" | "doctor";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  admin: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
};

function renderPage(who: Who = "admin") {
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <AuditPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetAuditMocks);

const entries = () => screen.findByRole("table", { name: "Entries" });
const rows = () => within(screen.getByRole("table", { name: "Entries" })).getAllByRole("row");

describe("audit log screen", () => {
  it("lists entries newest first with who, action, resource and outcome", async () => {
    renderPage();
    const table = await entries();
    expect(await screen.findByText("12 entries")).toBeInTheDocument();
    const first = within(table).getAllByRole("row")[1];
    expect(first).toHaveTextContent("dr.ada");
    expect(first).toHaveTextContent("Read");
    expect(first).toHaveTextContent("patients.patient");
    expect(first).toHaveTextContent("Allowed");
    expect(within(table).getByText("Refused")).toBeInTheDocument();
  });

  it("summarises entries, refusals, break-glass and reviews", async () => {
    renderPage();
    const list = await screen.findByLabelText("Audit summary");
    await waitFor(() => expect(list).toHaveTextContent("Entries12"));
    expect(list).toHaveTextContent("Refused1");
    expect(list).toHaveTextContent("Break-glass2");
    expect(list).toHaveTextContent("Reviewed1");
  });

  it("pins break-glass access above the table, with the reason each time", async () => {
    renderPage();
    const pinned = await screen.findByRole("region", { name: "Break-glass access" });
    expect(pinned).toHaveTextContent("Patient collapsed in the waiting area");
    expect(pinned).toHaveTextContent("Covering the night shift for Ward B");
    // The pinned section comes before the table in the page.
    const table = await entries();
    expect(pinned.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("tints break-glass rows in the table", async () => {
    renderPage();
    await entries();
    const glass = rows().filter((r) => /Break glass/.test(r.textContent ?? ""));
    expect(glass.length).toBe(3); // two accesses and one review
    for (const row of glass) expect(row.className).toMatch(/bg-pink|pink/);
    const plain = rows().find((r) => /Create/.test(r.textContent ?? ""))!;
    expect(plain.className).not.toMatch(/pink/);
  });

  it("searches, and the summary follows the search", async () => {
    renderPage();
    await entries();
    await userEvent.type(screen.getByLabelText(/Search the audit log/), "invoice");
    await waitFor(() => expect(screen.getByText("2 entries")).toBeInTheDocument());
    const list = screen.getByLabelText("Audit summary");
    await waitFor(() => expect(list).toHaveTextContent("Entries2"));
  });

  it("filters by action and outcome", async () => {
    renderPage();
    await entries();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Outcome" }));
    await userEvent.click(await screen.findByRole("option", { name: "Refused" }));
    await waitFor(() => expect(screen.getByText("1 entry")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
  });

  it("shows only break-glass from the pinned section", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Show only break-glass" }));
    await waitFor(() => expect(screen.getByText("2 entries")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
  });

  it("filters by date range and says when nothing matches", async () => {
    renderPage();
    await entries();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.type(within(panel).getByLabelText("From"), "2999-01-01");
    expect(await screen.findByText("No entries match your search.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => expect(screen.getByText("12 entries")).toBeInTheDocument());
  });

  it("exports the filtered log as a CSV", async () => {
    const create = vi.fn(() => "blob:audit");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    await entries();
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(auditMock.exports).toBe(1));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(create).toHaveBeenCalled();
    expect(await screen.findByText("Export downloaded")).toBeInTheDocument();
    click.mockRestore();
  });

  it("tells a role without access that it has none", async () => {
    renderPage("doctor");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("filters", () => {
  it("counts the filters that are on, not the search", () => {
    expect(activeFilters(NO_FILTERS)).toBe(0);
    expect(activeFilters({ ...NO_FILTERS, q: "ada", action: "read", dateFrom: "2026-10-01" })).toBe(
      2,
    );
  });

  it("leaves unset filters out of the query", () => {
    expect(toQuery(NO_FILTERS)).toEqual({
      q: undefined,
      action: undefined,
      outcome: undefined,
      date_from: undefined,
      date_to: undefined,
    });
    expect(toQuery({ ...NO_FILTERS, action: "break_glass", dateTo: "2026-10-21" })).toMatchObject({
      action: "break_glass",
      date_to: "2026-10-21",
    });
  });

  it("treats a break-glass access and its review as break-glass rows", () => {
    expect(isBreakGlass({ action: "break_glass" })).toBe(true);
    expect(isBreakGlass({ action: "break_glass_review" })).toBe(true);
    expect(isBreakGlass({ action: "read" })).toBe(false);
  });
});
