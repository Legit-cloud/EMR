import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ClaimsPage from "@/app/(app)/claims/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { claimAction } from "@/lib/claims";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { claims, resetClaimMocks } from "@/mocks/claims";

vi.setConfig({ testTimeout: 90_000 });

type Who = "billing" | "finance" | "doctor";
const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  billing: { signedIn: "ngozi.billing", me: MOCK_USERS["ngozi.billing"] },
  finance: { signedIn: "femi.finance", me: MOCK_USERS["femi.finance"] },
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
};

function renderPage(who: Who = "billing") {
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <ClaimsPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetClaimMocks);

const table = () => screen.findByRole("table", { name: "Claims" });
const rowOf = (t: HTMLElement, text: string) =>
  within(t).getByText(text).closest("tr") as HTMLElement;

describe("insurer claims", () => {
  it("lists claims not yet paid, with what each insurer owes by age", async () => {
    renderPage();
    const t = await table();
    expect(rowOf(t, "Tolu Okafor")).toHaveTextContent("Draft");
    expect(rowOf(t, "Dayo Ade")).toHaveTextContent("Pre-authorisation was missing");
    expect(within(t).queryByText("Ife Bello")).toBeNull();
    const owed = await screen.findByRole("region", { name: "What insurers owe" });
    expect(owed).toHaveTextContent("0-30 days");
    expect(owed).toHaveTextContent("₦18,000.00");
  });

  it("sends a draft claim to the insurer", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Tolu Okafor")).getByRole("button", {
        name: "Send to insurer: Tolu Okafor",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Send this claim" });
    expect(dialog).toHaveTextContent("₦8,000.00");
    await userEvent.type(within(dialog).getByLabelText(/claim number/), "HMO-55");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(claims.calls[0]).toMatchObject({
        path: "a1/submit",
        body: { insurer_reference: "HMO-55" },
      }),
    );
    expect(await screen.findByText("Claim sent")).toBeInTheDocument();
  });

  it("approves part of a claim only with a reason", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Bisi Lawal")).getByRole("button", { name: /Record the answer/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Record the insurer's answer" });
    const amount = within(dialog).getByLabelText(/Amount approved/);
    await userEvent.clear(amount);
    await userEvent.type(amount, "10000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save answer" }));
    expect(await within(dialog).findByText("Say why they approved less.")).toBeInTheDocument();
    expect(claims.calls).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText(/Note/), "Plan limit on this procedure");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save answer" }));
    await waitFor(() =>
      expect(claims.calls[0]).toMatchObject({
        path: "b2/approve",
        body: { approved_minor: 1_000_000 },
      }),
    );
  });

  it("records a rejection with the reason the insurer gave", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Bisi Lawal")).getByRole("button", { name: /Record the answer/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Record the insurer's answer" });
    await userEvent.click(
      within(dialog).getByRole("combobox", { name: "What the insurer decided" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Rejected" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save answer" }));
    expect(
      await within(dialog).findByText("Write the reason the insurer gave."),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Reason they gave"), "Cover had lapsed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save answer" }));
    await waitFor(() =>
      expect(claims.calls[0]).toMatchObject({
        path: "b2/reject",
        body: { reason: "Cover had lapsed" },
      }),
    );
  });

  it("records money received, and needs the insurer's reference", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Chidi Nwosu")).getByRole("button", { name: /Record a payment/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Record a payment from the insurer" });
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveValue("6000.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(await within(dialog).findByText("Enter the payment reference.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/payment reference/), "REM-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    await waitFor(() =>
      expect(claims.calls[0]).toMatchObject({
        path: "c3/settle",
        body: { amount_minor: 600_000, reference: "REM-1" },
      }),
    );
    expect(await screen.findByText("Payment recorded")).toBeInTheDocument();
  });

  it("lets a rejected claim be sent again", async () => {
    renderPage();
    const t = await table();
    await userEvent.click(
      within(rowOf(t, "Dayo Ade")).getByRole("button", { name: "Send again: Dayo Ade" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Send this claim again" });
    expect(dialog).toHaveTextContent("Pre-authorisation was missing");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(claims.calls[0]).toMatchObject({ path: "d4/submit" }));
  });

  it("shows finance the claims but no buttons to work them", async () => {
    renderPage("finance");
    const t = await table();
    expect(rowOf(t, "Tolu Okafor")).toBeInTheDocument();
    expect(within(t).queryByRole("button")).toBeNull();
  });

  it("tells someone who may not see claims that they have no access", async () => {
    renderPage("doctor");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
  });
});

describe("claimAction", () => {
  it("offers the next step for each state", () => {
    expect(claimAction({ status: "draft" })).toBe("send");
    expect(claimAction({ status: "submitted" })).toBe("answer");
    expect(claimAction({ status: "approved" })).toBe("pay");
    expect(claimAction({ status: "rejected" })).toBe("resend");
    expect(claimAction({ status: "paid" })).toBeNull();
  });
});
