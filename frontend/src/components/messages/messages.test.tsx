import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MessagesPage from "@/app/(app)/messages/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { memberLine, preview } from "@/lib/messages";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import {
  messageHandlers,
  messagePeopleHandler,
  resetMessageMocks,
  threads,
} from "@/mocks/messages";
import { server } from "@/mocks/server";

vi.setConfig({ testTimeout: 90_000 });

function renderPage() {
  resetAuthMocks("ada.doctor");
  server.use(...messageHandlers, messagePeopleHandler);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={MOCK_USERS["ada.doctor"]}>
            <MessagesPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetMessageMocks);

describe("message helpers", () => {
  it("cuts a preview at a word", () => {
    expect(preview("short")).toBe("short");
    expect(preview("a ".repeat(60), 20).endsWith("…")).toBe(true);
    expect(preview(null)).toBe("");
  });

  it("names the other people in a thread", () => {
    expect(memberLine(["Me", "Ada"], "Me")).toBe("Ada");
    expect(memberLine(["Me", "Ada", "Bola"], "Me")).toBe("Ada and Bola");
    expect(memberLine(["Me", "A", "B", "C", "D"], "Me")).toBe("A, B and 2 others");
  });
});

describe("messages screen", () => {
  it("lists threads with the unread count and opens one, which marks it read", async () => {
    renderPage();
    const row = await screen.findByRole("button", { name: /Bed 4 linen/ });
    expect(within(row).getByLabelText("1 unread")).toBeInTheDocument();
    await userEvent.click(row);
    expect(
      await screen.findByText("Please send clean linen.", {
        selector: "span.whitespace-pre-wrap",
      }),
    ).toBeInTheDocument();
    expect(threads[0].unread).toBe(0);
  });

  it("sends a reply", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Bed 4 linen/ }));
    await userEvent.type(await screen.findByLabelText("Reply"), "On its way");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await screen.findByText("On its way", { selector: "span.whitespace-pre-wrap" });
    expect(threads[0].messages).toHaveLength(2);
  });

  it("asks for a recipient, a subject and a message before sending", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New message" }));
    const dialog = await screen.findByRole("dialog", { name: "New message" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(await within(dialog).findByText("Choose at least one person.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a subject.")).toBeInTheDocument();
    expect(within(dialog).getByText("Write a message.")).toBeInTheDocument();
  });

  it("starts a thread with the chosen person", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New message" }));
    const dialog = await screen.findByRole("dialog", { name: "New message" });
    await userEvent.click(await within(dialog).findByLabelText("Bola Adeyemi"));
    await userEvent.type(within(dialog).getByLabelText("Subject"), "Roster");
    await userEvent.type(within(dialog).getByLabelText("Message"), "Can you swap Friday?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText("Message sent");
    expect(threads[0].subject).toBe("Roster");
    expect(threads[0].members).toContain("user-bola");
  });
});
