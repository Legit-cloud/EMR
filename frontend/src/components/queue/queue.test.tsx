import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueueScreen } from "@/components/queue/queue-screen";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { appointments, resetAppointmentMocks } from "@/mocks/appointments";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { MockWebSocket } from "@/mocks/queue-socket";
import { server } from "@/mocks/server";

// A live table with timers and a socket: allow for a slow, busy host.
vi.setConfig({ testTimeout: 60_000 });

vi.mock("next/navigation", () => ({
  usePathname: () => "/queue",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

type Entry = Schemas["QueueEntry"];

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function entry(id: string, name: string, priority: number | null, waited: number): Entry {
  return {
    appointment_id: id,
    patient_id: `patient-${id}`,
    patient_name: name,
    mrn: `2026-0003${id.slice(-2)}`,
    appointment_type: "new",
    reason: "Headache",
    triage_priority: priority,
    checked_in_at: minutesAgo(waited),
    start_at: minutesAgo(waited + 5),
  };
}

let initial: Entry[] = [];

function renderQueue(who: "doctor" | "desk" = "doctor") {
  const user = who === "doctor" ? "ada.doctor" : "tunde.desk";
  resetAuthMocks(user);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={MOCK_USERS[user]}>
            <QueueScreen />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

async function connected() {
  await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
  act(() => MockWebSocket.latest.open());
  await waitFor(() => expect(screen.getByTestId("connection")).toHaveTextContent("Live"));
}

const names = () =>
  within(screen.getByRole("table", { name: "Patients waiting, in order" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent ?? "");

beforeEach(() => {
  MockWebSocket.reset();
  vi.stubGlobal("WebSocket", MockWebSocket);
  resetAppointmentMocks();
  initial = [
    entry("a1", "Ngozi Eze", 2, 5),
    entry("a2", "Tunde Bello", 3, 20),
    entry("a3", "Chidi Obi", null, 45),
  ];
  server.use(http.get("*/api/scheduling/appointments/queue/", () => HttpResponse.json(initial)));
});
afterEach(() => vi.unstubAllGlobals());

describe("physician queue (FR-3.x)", () => {
  it("lists the waiting patients with priority, waiting time and reason", async () => {
    renderQueue();
    expect(await screen.findByText("Ngozi Eze")).toBeVisible();
    expect(names().map((n) => n.split("2026")[0])).toEqual([
      "Ngozi Eze",
      "Tunde Bello",
      "Chidi Obi",
    ]);
    const table = screen.getByRole("table", { name: "Patients waiting, in order" });
    expect(within(table).getByText("Urgent")).toBeVisible();
    expect(within(table).getByText("Routine")).toBeVisible();
    expect(within(table).getByText("Not triaged")).toBeVisible();
    expect(within(table).getAllByText("Headache")).toHaveLength(3);
  });

  it("turns the waiting chip amber, then pink, as the wait grows", async () => {
    renderQueue();
    await screen.findByText("Ngozi Eze");
    const chips = Array.from(document.querySelectorAll("[data-wait]")).map((chip) =>
      chip.getAttribute("data-wait"),
    );
    expect(chips).toEqual(["normal", "long", "very_long"]);
    // Not by colour alone: the words are there for screen readers.
    expect(screen.getByText(", very long wait")).toBeInTheDocument();
  });

  it("reorders and announces when a check-in arrives over the socket", async () => {
    renderQueue();
    await screen.findByText("Ngozi Eze");
    await connected();
    const emergency = entry("a4", "Bisi Lawal", 1, 0);
    act(() =>
      MockWebSocket.latest.receive({
        type: "queue",
        queue: [emergency, initial[0], initial[1], initial[2]],
      }),
    );
    await waitFor(() => expect(names()[0]).toContain("Bisi Lawal"));
    expect(names().map((n) => n.split("2026")[0])).toEqual([
      "Bisi Lawal",
      "Ngozi Eze",
      "Tunde Bello",
      "Chidi Obi",
    ]);
    expect(screen.getByTestId("queue-announcement")).toHaveTextContent(
      "Bisi Lawal checked in. 4 waiting.",
    );
    // The new arrival is highlighted for a moment, the others are not.
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0].className).toContain("animate-arrive");
    expect(rows[1].className).not.toContain("animate-arrive");
  });

  it("drops a patient from the list when the consultation starts elsewhere", async () => {
    renderQueue();
    await screen.findByText("Ngozi Eze");
    await connected();
    act(() => MockWebSocket.latest.receive({ type: "queue", queue: initial.slice(1) }));
    await waitFor(() => expect(screen.queryByText("Ngozi Eze")).not.toBeInTheDocument());
    expect(screen.getByTestId("queue-announcement")).toHaveTextContent("Queue updated: 2 waiting.");
  });

  it("shows a Reconnecting banner when the connection drops, and clears it when it is back", async () => {
    renderQueue();
    await screen.findByText("Ngozi Eze");
    await connected();
    act(() => MockWebSocket.latest.drop(1006));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reconnecting");
    expect(screen.getByTestId("connection")).toHaveTextContent("Reconnecting");
    // The list stays on screen while it reconnects.
    expect(screen.getByText("Ngozi Eze")).toBeVisible();

    // It tries again by itself, after a short wait.
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(2), { timeout: 10_000 });
    act(() => MockWebSocket.latest.open());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByTestId("connection")).toHaveTextContent("Live");
  });

  it("does not keep retrying when the server refuses the connection", async () => {
    renderQueue();
    await screen.findByText("Ngozi Eze");
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    act(() => MockWebSocket.latest.drop(4403));
    expect(await screen.findByText(/Live updates are not allowed/)).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("starts a consultation for the patient whose button is pressed", async () => {
    const user = userEvent.setup();
    renderQueue();
    await user.click(
      await screen.findByRole("button", { name: "Start consultation for Ngozi Eze" }),
    );
    await waitFor(() =>
      expect(appointments.calls).toContainEqual({
        path: "status/a1",
        body: { status: "in_consultation", cancellation_reason: "" },
      }),
    );
    expect(await screen.findByText("Consultation started")).toBeVisible();
  });

  it("offers no Start consultation to the front desk", async () => {
    renderQueue("desk");
    await screen.findByText("Ngozi Eze");
    expect(screen.queryByRole("button", { name: /Start consultation/ })).not.toBeInTheDocument();
  });

  it("says when nobody is waiting", async () => {
    initial = [];
    renderQueue();
    expect(await screen.findByText("Nobody is waiting.")).toBeVisible();
  });
});
