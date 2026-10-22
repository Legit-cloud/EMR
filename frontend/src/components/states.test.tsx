import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuditPage from "@/app/(app)/audit/page";
import BillingPage from "@/app/(app)/billing/page";
import PatientsPage from "@/app/(app)/patients/page";
import StockPage from "@/app/(app)/pharmacy/stock/page";
import StaffPage from "@/app/(app)/staff/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { server } from "@/mocks/server";
import { staffHandlers } from "@/mocks/staff";

/**
 * Every list screen has a loading, an error, and a no-permission state (docs/DESIGN.md Section 8,
 * "States every screen must handle"). The empty state is tested with each screen.
 */
vi.setConfig({ testTimeout: 60_000 });

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Case = {
  name: string;
  Page: ComponentType;
  who: string;
  url: string;
  caption: string;
  search?: string;
  /** The request whose refusal shows the page as no-access, when it is not the list itself. */
  refuseUrl?: string;
};

const CASES: Case[] = [
  {
    name: "patients",
    Page: PatientsPage,
    who: "ada.doctor",
    url: "*/api/patients/patients/",
    caption: "Patients",
  },
  {
    name: "invoices",
    Page: BillingPage,
    who: "ngozi.billing",
    url: "*/api/billing/invoices/",
    caption: "Invoices",
  },
  {
    name: "staff",
    Page: StaffPage,
    who: "bisi.finance",
    url: "*/api/staff/profiles/",
    caption: "Doctors",
    refuseUrl: "*/api/staff/profiles/summary/",
  },
  {
    name: "audit log",
    Page: AuditPage,
    who: "bisi.finance",
    url: "*/api/audit/entries/",
    caption: "Entries",
  },
  {
    name: "stock inventory",
    Page: StockPage,
    who: "pita.pharmacist",
    url: "*/api/pharmacy/stock/inventory/",
    caption: "Inventory",
  },
  {
    name: "stock orders",
    Page: StockPage,
    who: "pita.pharmacist",
    url: "*/api/pharmacy/orders/",
    caption: "Orders",
    search: "tab=orders",
  },
];

const failure = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: "Refused.", details: {} } }, { status });

function show({ Page, who, search }: Case) {
  nav.search = search ?? "";
  resetAuthMocks(who);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={MOCK_USERS[who]}>
            <Page />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  // The appointments mock also answers the staff URL; use the staff screen's own.
  server.use(...staffHandlers);
});

describe.each(CASES)("$name", (scenario) => {
  it("shows that it is loading while it waits", async () => {
    server.use(http.get(scenario.url, () => new Promise(() => {})));
    show(scenario);
    expect(
      await screen.findByText(new RegExp(`Loading ${scenario.caption}`, "i")),
    ).toBeInTheDocument();
  });

  it("says what failed and offers to try again, when the server errors", async () => {
    server.use(http.get(scenario.url, () => failure(500, "error")));
    show(scenario);
    expect(await screen.findByText(`${scenario.caption} could not be loaded.`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  });

  it("shows no data and says so when the server refuses", async () => {
    server.use(
      http.get(scenario.refuseUrl ?? scenario.url, () => failure(403, "permission_denied")),
    );
    show(scenario);
    expect(await screen.findByText(/do not have access|No access to/i)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: scenario.caption })).toBeNull();
  });
});
