import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RequestsPage from "@/app/(app)/requests/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { dueText } from "@/lib/data-requests";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { dataRequests, resetDataRequestMocks } from "@/mocks/data-requests";

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
            <RequestsPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetDataRequestMocks);

const table = () => screen.findByRole("table", { name: "Requests" });
const rowOf = (t: HTMLElement, text: string) =>
  within(t).getByText(text).closest("tr") as HTMLElement;

describe("data requests", () => {
  it("lists what patients have asked for, the late ones first and marked", async () => {
    renderPage();
    const t = await table();
    const rows = within(t).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Tolu Okafor");
    expect(rows[1]).toHaveTextContent("Overdue");
    expect(rows[1]).toHaveTextContent("3 days late");
    expect(rowOf(t, "Bisi Lawal")).toHaveTextContent("12 days left");
    expect(rowOf(t, "Bisi Lawal")).not.toHaveTextContent("Overdue");
    expect(rowOf(t, "Bisi Lawal")).toHaveTextContent("My date of birth is wrong on my card");
  });

  it("filters to only the overdue requests", async () => {
    renderPage();
    await table();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("checkbox", { name: "Only overdue requests" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByText("Tolu Okafor")).toBeInTheDocument();
  });

  it("answers a request with a written reason, then it leaves the open list", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Bisi Lawal")).getByRole("button", {
        name: "Answer the request from Bisi Lawal",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Answer this request" });
    expect(dialog).toHaveTextContent("My date of birth is wrong on my card");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    expect(await within(dialog).findByText("Write at least a sentence.")).toBeInTheDocument();
    expect(dataRequests.calls).toHaveLength(0);
    await userEvent.type(
      within(dialog).getByLabelText("What was done"),
      "Corrected the date of birth on the record.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(dataRequests.calls).toHaveLength(1));
    expect(dataRequests.calls[0].body).toMatchObject({ status: "completed" });
    expect(await screen.findByText("Request answered")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Bisi Lawal", { selector: "td *" })).toBeNull());
  });

  it("records a refusal as one, and asks for the reason", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Chidi Nwosu")).getByRole("button", { name: /Answer the request from/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Answer this request" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Outcome" }));
    await userEvent.click(await screen.findByRole("option", { name: "Refused, with a reason" }));
    await userEvent.type(
      within(dialog).getByLabelText("Reason for refusing"),
      "Medical records must be kept for the legal retention period.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(dataRequests.calls[0].body).toMatchObject({ status: "refused" }));
  });

  it("tells someone who may not see the queue that they have no access", async () => {
    renderPage("doctor");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("dueText", () => {
  const today = new Date(2026, 9, 23);
  it("counts days left, today, and days late", () => {
    expect(dueText("2026-10-24", today)).toBe("1 day left");
    expect(dueText("2026-11-22", today)).toBe("30 days left");
    expect(dueText("2026-10-23", today)).toBe("Due today");
    expect(dueText("2026-10-22", today)).toBe("1 day late");
    expect(dueText("2026-10-20", today)).toBe("3 days late");
  });
});
