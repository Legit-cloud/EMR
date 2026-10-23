import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(app)/dashboard/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";

import { formatWait, waitTone } from "./clinical";
import { percentChange, periodLabel } from "./finance";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/** Render as `username`; `session` overrides the /auth/me profile the page sees. */
function renderAs(username: keyof typeof MOCK_USERS, session?: Schemas["Me"]) {
  const me = session ?? MOCK_USERS[username];
  resetAuthMocks(username);
  return render(
    <ToastProvider>
      <QueryClientProvider client={createQueryClient(vi.fn())}>
        <TooltipProvider>
          <SessionContext.Provider value={me}>
            <DashboardPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => resetAuthMocks());

describe("dashboard, management view (mock layer)", () => {
  it("shows the finance and operations cards the API returns for a tenant admin", async () => {
    renderAs("bisi.finance");
    expect(await screen.findByRole("region", { name: "Cashflow" })).toBeInTheDocument();
    for (const name of [
      "Revenue by service",
      "Billed and collected",
      "Stock availability",
      "Patients seen",
      "Popular services",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: "Waiting for you" })).not.toBeInTheDocument();

    const stock = screen.getByRole("region", { name: "Stock availability" });
    const reorder = within(stock).getByRole("list", { name: "Drugs to reorder" });
    expect(within(reorder).getAllByRole("listitem")[0]).toHaveTextContent(
      "Metformin 500 mg0 left · reorder at 40Out",
    );
    const patients = screen.getByRole("region", { name: "Patients seen" });
    expect(patients).toHaveTextContent("New3825% of visits");
    expect(patients).toHaveTextContent("Returning11275% of visits");
  });

  it("shows beds, tests and what insurers owe, and a doctor's results to review", async () => {
    const { unmount } = renderAs("bisi.finance");
    const wards = await screen.findByRole("region", { name: "Wards and beds" });
    expect(wards).toHaveTextContent("Patients admitted17");
    expect(wards).toHaveTextContent("17 of 24 beds in use");
    expect(screen.getByRole("region", { name: "Tests and scans" })).toHaveTextContent(
      "Waiting for a result6",
    );
    const claims = screen.getByRole("region", { name: "Insurer claims" });
    expect(claims).toHaveTextContent("₦42,000.00");
    expect(within(claims).getAllByRole("listitem")).toHaveLength(4);
    unmount();

    renderAs("ada.doctor");
    const tasks = await screen.findByRole("region", { name: "Your tasks" });
    expect(tasks).toHaveTextContent("Results to review3");
  });

  it("switches the whole dashboard to the last 30 days", async () => {
    renderAs("bisi.finance");
    const cashflow = await screen.findByRole("region", { name: "Cashflow" });
    expect(within(cashflow).getByRole("figure", { name: /12 points/ })).toBeInTheDocument();
    await userEvent.click(within(cashflow).getByRole("combobox", { name: "Dashboard period" }));
    await userEvent.click(await screen.findByRole("option", { name: "Last 30 days" }));
    expect(await within(cashflow).findByRole("figure", { name: /30 points/ })).toBeInTheDocument();
  });
});

describe("dashboard, clinical view (mock layer)", () => {
  it("shows a doctor their queue and tasks, and no finance figures", async () => {
    renderAs("ada.doctor");
    const queue = await screen.findByRole("region", { name: "Waiting for you" });
    const rows = await within(queue).findAllByRole("row");
    expect(rows[1]).toHaveTextContent("Ngozi Synthetic");
    // Checked in 45 minutes before the request; the clock may read a minute either side.
    expect(rows[1]).toHaveTextContent(/4[4-6] min/);
    expect(within(rows[1]).getByRole("link", { name: "Ngozi Synthetic" })).toHaveAttribute(
      "href",
      "/patients/8a5e2f8c-0000-4000-8000-000000000001",
    );
    const tasks = screen.getByRole("region", { name: "Your tasks" });
    expect(tasks).toHaveTextContent("Consultation notes to close2");
    expect(tasks).toHaveTextContent("Prescriptions to sign1");
    expect(screen.queryByRole("region", { name: "Cashflow" })).not.toBeInTheDocument();
  });

  it("gives roles without figures their shortcuts instead", async () => {
    const hr: Schemas["Me"] = {
      ...MOCK_USERS["tunde.desk"],
      roles: ["hr"],
      assignments: [{ role: "hr", facility: null, department: null }],
    };
    // The mock dashboard has no cards for the desk account, as for HR.
    renderAs("tunde.desk", hr);
    expect(await screen.findByRole("region", { name: "Your work" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Staff list" })).toBeInTheDocument();
  });
});

describe("dashboard helpers", () => {
  it("compares with the previous period only when there was one", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeUndefined();
  });

  it("labels months and days", () => {
    expect(periodLabel("2026-03-01", "12m")).toBe("Mar");
    expect(periodLabel("2026-10-14", "30d")).toBe("14 Oct");
  });

  it("turns waiting times amber after 30 minutes and pink after an hour", () => {
    expect(waitTone(29)).toBe("grey");
    expect(waitTone(30)).toBe("amber");
    expect(waitTone(60)).toBe("pink");
  });

  it("shows long waits in hours and minutes", () => {
    expect(formatWait(45)).toBe("45 min");
    expect(formatWait(60)).toBe("1 h");
    expect(formatWait(337)).toBe("5 h 37 min");
  });
});
