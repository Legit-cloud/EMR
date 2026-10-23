import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InpatientPage from "@/app/(app)/inpatient/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { countBeds, dischargeNoteError, stayDay, transferTargets } from "@/lib/inpatient";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import {
  BED_CLEANING,
  BED_OCCUPIED,
  BED_OUT,
  BED_VACANT,
  inpatient,
  resetInpatientMocks,
} from "@/mocks/inpatient";
import { MOCK_PATIENTS } from "@/mocks/patients";

vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inpatient",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Who = "nurse" | "admin" | "front_desk";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  nurse: {
    signedIn: "ada.doctor",
    me: { ...MOCK_USERS["ada.doctor"], roles: ["nurse"] },
  },
  admin: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  front_desk: { signedIn: "tunde.desk", me: MOCK_USERS["tunde.desk"] },
};

function renderBoard(who: Who = "nurse", bed?: string) {
  nav.search = bed ? `bed=${bed}` : "";
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <InpatientPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  resetInpatientMocks();
});

const tile = (name: RegExp) => screen.findByRole("button", { name });
const drawer = (name: RegExp) => screen.findByRole("dialog", { name });

describe("the ward board", () => {
  it("shows a tile for every bed, in its state, with who is in it", async () => {
    renderBoard();
    expect(await screen.findByText("9 beds")).toBeInTheDocument();
    const occupied = await tile(/Medical ward, Bed 1, Occupied, Ngozi Eze/);
    expect(occupied).toHaveTextContent("Day 3");
    expect(await tile(/Medical ward, Bed 3, Vacant/)).toHaveTextContent("Ready for a patient");
    expect(await tile(/Medical ward, Bed 5, Cleaning/)).toBeInTheDocument();
    expect(await tile(/Medical ward, Bed 6, Out of service/)).toBeInTheDocument();
    expect(screen.getByText("2 of 6 occupied")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 occupied")).toBeInTheDocument();
  });

  it("counts beds by status", async () => {
    renderBoard();
    const counts = await screen.findByRole("list", { name: "Beds by status" });
    await waitFor(() => expect(counts).toHaveTextContent("Vacant4"));
    expect(counts).toHaveTextContent("Occupied3");
    expect(counts).toHaveTextContent("Cleaning1");
    expect(counts).toHaveTextContent("Out of service1");
  });

  it("opens a bed in the address, so a link opens the drawer", async () => {
    renderBoard();
    await userEvent.click(await tile(/Medical ward, Bed 1/));
    expect(nav.replace).toHaveBeenCalledWith("/inpatient?bed=bed-m-1", { scroll: false });
  });

  it("tells a role without access that it has none", async () => {
    renderBoard("front_desk");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
  });

  it("says so when the module is not available", async () => {
    inpatient.forbidden = false;
    const { server } = await import("@/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get("*/api/inpatient/wards/", () =>
        HttpResponse.json(
          { error: { code: "not_found", message: "Not found.", details: {} } },
          { status: 404 },
        ),
      ),
    );
    renderBoard();
    expect(await screen.findByText("Inpatient care is not available yet.")).toBeInTheDocument();
  });
});

describe("admitting", () => {
  it("admits a patient to a vacant bed, which becomes occupied", async () => {
    renderBoard("nurse", BED_VACANT);
    const panel = await drawer(/Medical ward, Bed 3/);
    expect(within(panel).getByText("Vacant")).toBeInTheDocument();
    const patient = MOCK_PATIENTS[2];
    await userEvent.click(within(panel).getByRole("combobox", { name: "Patient" }));
    await userEvent.keyboard(patient.first_name);
    await userEvent.click(
      await screen.findByRole("option", {
        name: new RegExp(`${patient.first_name} ${patient.last_name}`),
      }),
    );
    await userEvent.type(
      within(panel).getByLabelText("Reason for admission"),
      "Observation after surgery",
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Admit patient" }));

    await waitFor(() => expect(inpatient.calls.at(-1)?.path).toBe("admit"));
    expect(inpatient.calls.at(-1)?.body).toMatchObject({
      patient: patient.id,
      bed: BED_VACANT,
      reason: "Observation after surgery",
    });
    expect(inpatient.wards[0].beds[2]).toMatchObject({ status: "occupied" });
    expect(await screen.findByText("Patient admitted")).toBeInTheDocument();
    expect(nav.replace).toHaveBeenCalledWith("/inpatient", { scroll: false });
  });

  it("asks for the patient and a reason before sending anything", async () => {
    renderBoard("nurse", BED_VACANT);
    const panel = await drawer(/Medical ward, Bed 3/);
    await userEvent.click(within(panel).getByRole("button", { name: "Admit patient" }));
    expect(await within(panel).findByText("Choose the patient.")).toBeInTheDocument();
    expect(within(panel).getByText("Say why the patient is being admitted.")).toBeInTheDocument();
    expect(inpatient.calls).toHaveLength(0);
  });
});

describe("transferring and discharging", () => {
  async function openSection(name: string) {
    const panel = await drawer(/Medical ward, Bed 1/);
    await userEvent.click(within(panel).getByRole("tab", { name }));
    return panel;
  }

  it("shows the patient with the admission day and reason", async () => {
    renderBoard("nurse", BED_OCCUPIED);
    const panel = await drawer(/Medical ward, Bed 1/);
    expect(panel).toHaveTextContent("Ngozi Eze");
    expect(panel).toHaveTextContent("Day 3");
    expect(panel).toHaveTextContent("Severe malaria");
  });

  it("moves the patient to a vacant bed and sends the old one to cleaning", async () => {
    renderBoard("nurse", BED_OCCUPIED);
    const panel = await openSection("Transfer");
    await userEvent.click(within(panel).getByRole("combobox", { name: "Move to" }));
    await userEvent.click(await screen.findByRole("option", { name: "Paediatrics, Cot 2" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Transfer patient" }));
    await waitFor(() => expect(inpatient.calls.at(-1)?.path).toBe("transfer"));
    expect(inpatient.wards[0].beds[0]).toMatchObject({ status: "cleaning", occupant: null });
    expect(inpatient.wards[1].beds[1].occupant?.patient_name).toBe("Ngozi Eze");
  });

  it("offers only vacant beds, and not the one the patient is in", () => {
    const targets = transferTargets(inpatient.wards, BED_OCCUPIED).map((t) => t.value);
    expect(targets).toEqual(["bed-m-3", "bed-m-4", "bed-p-2", "bed-p-3"]);
  });

  it("discharges the patient and sends the bed to cleaning", async () => {
    renderBoard("nurse", BED_OCCUPIED);
    const panel = await openSection("Discharge");
    await userEvent.click(within(panel).getByRole("button", { name: "Discharge patient" }));
    await waitFor(() => expect(inpatient.calls.at(-1)?.path).toBe("discharge"));
    expect(inpatient.calls.at(-1)?.body).toMatchObject({ status: "discharged" });
    expect(inpatient.wards[0].beds[0]).toMatchObject({ status: "cleaning", occupant: null });
  });

  it.each([
    ["Left against medical advice", "lama", "Note what the patient was told about leaving."],
    ["Transferred", "transferred", "Say where the patient is being transferred to."],
  ])("needs a note to discharge as %s", async (label, status, message) => {
    renderBoard("nurse", BED_OCCUPIED);
    const panel = await openSection("Discharge");
    await userEvent.click(within(panel).getByRole("combobox", { name: "Discharge status" }));
    await userEvent.click(await screen.findByRole("option", { name: label }));
    await userEvent.click(within(panel).getByRole("button", { name: "Discharge patient" }));
    expect(await within(panel).findByText(message)).toBeInTheDocument();
    expect(inpatient.calls).toHaveLength(0);

    await userEvent.type(
      within(panel).getByLabelText(/Note|Transferred to/),
      "Daughter collected her",
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Discharge patient" }));
    await waitFor(() => expect(inpatient.calls.at(-1)?.body).toMatchObject({ status }));
  });

  it("marks a cleaned bed ready", async () => {
    renderBoard("nurse", BED_CLEANING);
    const panel = await drawer(/Medical ward, Bed 5/);
    await userEvent.click(within(panel).getByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(inpatient.wards[0].beds[4].status).toBe("vacant"));
  });

  it("does not let an out-of-service bed be used", async () => {
    renderBoard("nurse", BED_OUT);
    const panel = await drawer(/Medical ward, Bed 6/);
    expect(panel).toHaveTextContent("out of service");
    expect(within(panel).queryByRole("button", { name: /Admit|Mark ready/ })).toBeNull();
  });
});

describe("a tenant admin can look but not change", () => {
  it("shows the patient but no transfer or discharge", async () => {
    renderBoard("admin", BED_OCCUPIED);
    const panel = await drawer(/Medical ward, Bed 1/);
    expect(panel).toHaveTextContent("Ngozi Eze");
    expect(within(panel).queryByRole("tab", { name: "Transfer" })).toBeNull();
    expect(within(panel).queryByRole("tab", { name: "Discharge" })).toBeNull();
  });

  it("does not offer to admit to a vacant bed", async () => {
    renderBoard("admin", BED_VACANT);
    const panel = await drawer(/Medical ward, Bed 3/);
    expect(within(panel).queryByRole("button", { name: "Admit patient" })).toBeNull();
    expect(panel).toHaveTextContent("can look but not change");
  });
});

describe("the rules in the library", () => {
  it("counts beds by status", () => {
    expect(countBeds(inpatient.wards)).toEqual({
      vacant: 4,
      occupied: 3,
      cleaning: 1,
      out_of_service: 1,
      total: 9,
    });
  });

  it("counts the admission day as day 1", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    expect(stayDay("2026-10-21T08:00:00Z", now)).toBe(1);
    expect(stayDay("2026-10-19T08:00:00Z", now)).toBe(3);
    expect(stayDay("2026-10-30T08:00:00Z", now)).toBe(1);
  });

  it("needs a note for LAMA and a transfer, not for a plain discharge", () => {
    expect(dischargeNoteError("discharged", "")).toBeNull();
    expect(dischargeNoteError("lama", "   ")).toMatch(/told about leaving/);
    expect(dischargeNoteError("transferred", "UCH")).toMatch(/transferred to/);
    expect(dischargeNoteError("transferred", "UCH Ibadan")).toBeNull();
  });
});

describe("a patient who died", () => {
  it("can be closed as Died, which needs no note here and explains the chart comes first", async () => {
    renderBoard("nurse", BED_OCCUPIED);
    const panel = await drawer(/Medical ward, Bed 1/);
    await userEvent.click(within(panel).getByRole("tab", { name: "Discharge" }));
    await userEvent.click(within(panel).getByRole("combobox", { name: "Discharge status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Died" }));
    expect(
      within(panel).getByText(/A doctor records the death on the chart first/),
    ).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Discharge patient" }));
    await waitFor(() => expect(inpatient.calls.at(-1)?.body).toMatchObject({ status: "died" }));
  });

  it("needs no note, unlike LAMA and a transfer", () => {
    expect(dischargeNoteError("died", "")).toBeNull();
  });
});
