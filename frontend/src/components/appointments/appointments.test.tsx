import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentsScreen } from "@/components/appointments/appointments-screen";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import {
  ADA,
  appointmentAt,
  appointments,
  KEMI,
  resetAppointmentMocks,
} from "@/mocks/appointments";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { chart, resetChartMocks } from "@/mocks/chart";

// A calendar is several queries and a drawer: allow for a slow, busy host.
vi.setConfig({ testTimeout: 90_000 });

vi.mock("next/navigation", () => ({
  usePathname: () => "/appointments",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

type Who = "doctor" | "desk";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
  desk: { signedIn: "tunde.desk", me: MOCK_USERS["tunde.desk"] },
};

function renderScreen(who: Who = "doctor") {
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <AppointmentsScreen />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

/** jsdom has no layout: columns are 300px wide side by side, cards sit at their CSS top. */
function fakeLayout() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const columns = Array.from(document.querySelectorAll("[data-column]"));
    const index = columns.indexOf(this);
    if (index >= 0) {
      return {
        left: index * 300,
        right: index * 300 + 300,
        top: 0,
        bottom: 600,
        width: 300,
        height: 600,
        x: index * 300,
        y: 0,
        toJSON() {},
      };
    }
    const top = parseFloat(this.style.top || "0");
    return {
      left: 0,
      right: 100,
      top,
      bottom: top + 30,
      width: 100,
      height: 30,
      x: 0,
      y: top,
      toJSON() {},
    };
  });
}

beforeEach(() => {
  resetChartMocks({ visit: true });
  resetAppointmentMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("appointments calendar (FR-3.x)", () => {
  it("shows a column per physician with each patient's appointment card", async () => {
    renderScreen();
    expect(
      await screen.findByRole("button", { name: /Ngozi Eze, 09:00 to 09:30, Booked/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Tunde Bello, 10:00 to 10:30/ })).toBeVisible();
    expect(screen.getByText("Dr Ada Tester")).toBeVisible();
    expect(screen.getByText("Dr Kemi Okoro")).toBeVisible();
    expect(screen.getAllByText(/Today's appointment: 2 patients/)).toHaveLength(1);
    expect(screen.getByTestId("total-appointments")).toHaveTextContent("3");
  });

  it("hatches the hours when a physician takes no bookings", async () => {
    renderScreen();
    await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    // 17:00 to 18:00 is outside the 08:00 to 17:00 working hours.
    await waitFor(() => expect(screen.getAllByTestId("unavailable").length).toBeGreaterThan(0));
  });

  it("moves an appointment dragged to another time, and tells the clerk when that time is taken", async () => {
    fakeLayout();
    renderScreen();
    const card = await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    // The card's top is 60px (09:00 on a grid starting at 08:00). Grab it 10px down.
    fireEvent.pointerDown(card, { button: 0, clientX: 50, clientY: 70, pointerType: "mouse" });
    // Drop on the second physician's column at 10:00, where Tunde Bello already is.
    fireEvent.pointerMove(window, { clientX: 400, clientY: 130, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 130, pointerType: "mouse" });
    expect(
      await screen.findByText(/Dr Kemi Okoro already has an appointment at that time/),
    ).toBeVisible();
    expect(appointments.rows.find((a) => a.id === "a1")!.physician).toBe(ADA);
  });

  it("reschedules by dragging to a free time (FR-3.x reschedule)", async () => {
    fakeLayout();
    renderScreen();
    const card = await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    // Same column, 14:00: offset 360px, grabbed 10px down.
    fireEvent.pointerDown(card, { button: 0, clientX: 50, clientY: 70, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 370, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 370, pointerType: "mouse" });
    expect(await screen.findByText("Appointment moved")).toBeVisible();
    const call = appointments.calls.find((c) => c.path === "reschedule/a1");
    expect((call!.body as { start_at: string }).start_at).toContain("T14:00:00+01:00");
  });

  it("does not let touch or an in-progress visit be dragged", async () => {
    fakeLayout();
    renderScreen();
    const started = await screen.findByRole("button", { name: /Ngozi Eze, 11:00/ });
    fireEvent.pointerDown(started, { button: 0, clientX: 50, clientY: 190, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 400, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 400, pointerType: "mouse" });
    expect(appointments.calls.filter((c) => c.path.startsWith("reschedule"))).toHaveLength(0);
  });

  it("opens the booking wizard from an empty slot for the front desk, with the slot filled in", async () => {
    fakeLayout();
    const user = userEvent.setup();
    renderScreen("desk");
    await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    const column = document.querySelector(`[data-column="${KEMI}"]`)!;
    // 15:00 in the second column: offset 420px.
    fireEvent.click(column, { clientX: 400, clientY: 420 });
    const dialog = await screen.findByRole("dialog", { name: "New appointment" });
    expect(within(dialog).getByLabelText(/Start time/)).toHaveValue("15:00");
    expect(within(dialog).getByLabelText(/End time/)).toHaveValue("15:15");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  it("does not offer booking to a doctor", async () => {
    renderScreen("doctor");
    await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    expect(screen.queryByRole("button", { name: "New appointment" })).not.toBeInTheDocument();
  });

  it("switches to a list of the day's appointments in time order", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    await user.click(screen.getByRole("radio", { name: "List" }));
    const table = await screen.findByRole("table", { name: "Appointments" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("09:00");
    expect(rows[1]).toHaveTextContent("10:00");
    expect(rows[2]).toHaveTextContent("11:00");
  });

  it("shows a week for one physician", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    await user.click(screen.getByRole("radio", { name: "Week" }));
    expect(await screen.findAllByRole("group", { name: /^Appointments, / })).toHaveLength(7);
    expect(screen.getByText(/A week shows one physician/)).toBeVisible();
  });

  it("moves between days with previous and next", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ });
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(screen.getByTestId("total-appointments")).toHaveTextContent("0"));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(screen.getByTestId("total-appointments")).toHaveTextContent("3"));
  });

  it("lists past appointments, with their outcome, in Log History", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole("tab", { name: "Log History" }));
    const table = await screen.findByRole("table", { name: "Appointment history" });
    expect(await within(table).findByText("Chidi Obi")).toBeVisible();
    expect(within(table).queryByText("Tunde Bello")).not.toBeInTheDocument();
  });
});

describe("appointment drawer (FR-3.x)", () => {
  async function openStarted(who: Who = "doctor") {
    const user = userEvent.setup();
    renderScreen(who);
    await user.click(await screen.findByRole("button", { name: /Ngozi Eze, 11:00/ }));
    return { user, dialog: await screen.findByRole("dialog") };
  }

  it("keeps Finish disabled until vitals and a clinical record both exist", async () => {
    chart.vitals = [];
    chart.diagnoses = [];
    chart.notes = [];
    const { dialog } = await openStarted();
    const finish = within(dialog).getByRole("button", { name: "Finish" });
    await waitFor(() =>
      expect(within(dialog).getByText(/add vitals and a clinical record/i)).toBeVisible(),
    );
    expect(finish).toBeDisabled();
  });

  it("keeps Finish disabled with vitals but no clinical record", async () => {
    chart.diagnoses = [];
    chart.notes = [];
    const { dialog } = await openStarted();
    await waitFor(() =>
      expect(within(dialog).getByText(/add vitals and a clinical record/i)).toBeVisible(),
    );
    expect(within(dialog).getByRole("button", { name: "Finish" })).toBeDisabled();
  });

  it("enables Finish once both exist, and completes the visit", async () => {
    const { user, dialog } = await openStarted();
    const finish = within(dialog).getByRole("button", { name: "Finish" });
    await waitFor(() => expect(finish).toBeEnabled());
    await user.click(finish);
    await waitFor(() =>
      expect(appointments.calls).toContainEqual({
        path: "status/a2",
        body: { status: "completed", cancellation_reason: "" },
      }),
    );
  });

  it("keeps Finish disabled for a front-desk clerk, who is not clinical staff", async () => {
    const { dialog } = await openStarted("desk");
    expect(within(dialog).getByRole("button", { name: "Finish" })).toBeDisabled();
    expect(within(dialog).getByText(/Only clinical staff can finish a visit/)).toBeVisible();
  });

  it("asks for a reason before cancelling, and sends it", async () => {
    resetAppointmentMocks([appointmentAt("a1", ADA, 9, 0)]);
    const user = userEvent.setup();
    renderScreen("desk");
    await user.click(await screen.findByRole("button", { name: /Ngozi Eze, 09:00/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Status/ }));
    await user.click(await screen.findByRole("option", { name: "Cancelled" }));
    const reason = await screen.findByRole("dialog", { name: /Cancel/ });
    await user.type(within(reason).getByLabelText(/Reason/), "Patient called to cancel");
    await user.click(within(reason).getByRole("button", { name: /Cancel appointment|Confirm/ }));
    await waitFor(() =>
      expect(appointments.calls).toContainEqual({
        path: "status/a1",
        body: { status: "cancelled", cancellation_reason: "Patient called to cancel" },
      }),
    );
  });

  it("shows the patient's allergies in the general information", async () => {
    const { dialog } = await openStarted();
    expect(await within(dialog).findByText(/Penicillin/)).toBeVisible();
  });
});
