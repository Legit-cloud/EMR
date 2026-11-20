import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LeavePage from "@/app/(app)/leave/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { canCancel, checkLeaveDates, leaveRange } from "@/lib/leave";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { leaveHandlers, leaves, resetLeaveMocks } from "@/mocks/leave";
import { server } from "@/mocks/server";

vi.setConfig({ testTimeout: 90_000 });

function renderPage(who: string) {
  resetAuthMocks(who);
  server.use(...leaveHandlers);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={MOCK_USERS[who]}>
            <LeavePage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetLeaveMocks);

describe("leave rules", () => {
  it("checks the dates", () => {
    expect(checkLeaveDates("", "", "2026-11-20")).toMatch(/Choose/);
    expect(checkLeaveDates("2026-11-19", "2026-11-21", "2026-11-20")).toMatch(/past/);
    expect(checkLeaveDates("2026-11-25", "2026-11-24", "2026-11-20")).toMatch(/before/);
    expect(checkLeaveDates("2026-11-25", "2026-11-25", "2026-11-20")).toBeNull();
  });

  it("describes a range and says what can be cancelled", () => {
    expect(leaveRange({ start_date: "2026-12-01", end_date: "2026-12-03", days: 3 })).toBe(
      "1 Dec 2026 to 3 Dec 2026 (3 days)",
    );
    expect(canCancel({ status: "pending", start_date: "2020-01-01" }, "2026-11-20")).toBe(true);
    expect(canCancel({ status: "approved", start_date: "2026-11-20" }, "2026-11-20")).toBe(false);
    expect(canCancel({ status: "rejected", start_date: "2027-01-01" }, "2026-11-20")).toBe(false);
  });
});

describe("leave screen", () => {
  it("lets HR approve a pending request", async () => {
    renderPage("hana.hr");
    await userEvent.click(await screen.findByRole("button", { name: "Approve Amaka Obi's leave" }));
    await screen.findByText("Leave approved");
    expect(leaves.find((l) => l.id === "leave-1")?.status).toBe("approved");
  });

  it("makes HR give a reason before rejecting", async () => {
    renderPage("hana.hr");
    await userEvent.click(await screen.findByRole("button", { name: "Reject Amaka Obi's leave" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject leave" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject request" }));
    expect(
      await within(dialog).findByText("Say why the request is being rejected."),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Short staffed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject request" }));
    await screen.findByText("Leave rejected");
    expect(leaves.find((l) => l.id === "leave-1")?.decision_note).toBe("Short staffed");
  });

  it("gives other staff no approve or reject buttons", async () => {
    renderPage("ada.doctor");
    await screen.findByRole("table", { name: "Leave requests" });
    await screen.findAllByText("Annual leave");
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
  });

  it("shows a request form that refuses reversed dates", async () => {
    renderPage("ada.doctor");
    await userEvent.click(await screen.findByRole("button", { name: "Request leave" }));
    const dialog = await screen.findByRole("dialog", { name: "Request leave" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByText("Choose the first and last day.")).toBeInTheDocument();
  });
});
