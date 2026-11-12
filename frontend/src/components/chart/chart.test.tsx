import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PatientChart } from "@/components/chart/patient-chart";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { undoConfig } from "@/lib/use-undoable";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { CHART_PATIENT, chart, resetChartMocks } from "@/mocks/chart";
import { resetDiagnosticsMocks } from "@/mocks/diagnostics";

// A full chart is a dozen queries and several dialogs: allow for a slow, busy host.
vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => `/patients/${"8a5e2f8c-0000-4000-8000-0000000004aa"}`,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Who = "doctor" | "admin" | "pharmacist";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
  admin: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  pharmacist: {
    signedIn: "tunde.desk",
    me: {
      ...MOCK_USERS["tunde.desk"],
      roles: ["pharmacist"],
      assignments: [{ role: "pharmacist", facility: null, department: null }],
    },
  },
};

function renderChart(who: Who = "doctor", id = CHART_PATIENT) {
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <PatientChart id={id} />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  undoConfig.delayMs = 6000;
  resetChartMocks();
  resetDiagnosticsMocks();
});

const heading = () => screen.findByRole("heading", { level: 1, name: "Ngozi Eze" });
const tile = (name: string) =>
  within(screen.getByRole("list", { name: "Latest vital signs" })).getByRole("listitem", { name });
const calls = (path: string) => chart.calls.filter((c) => c.path === path);

async function openTab(name: RegExp | string) {
  await userEvent.click(await screen.findByRole("tab", { name }));
}

/** Open a Radix select inside `scope` and choose an option. */
async function choose(scope: ReturnType<typeof within>, label: string, option: string) {
  await userEvent.click(scope.getByRole("combobox", { name: label }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("the banner and overview", () => {
  it("shows who the patient is, their allergies and the tabs", async () => {
    renderChart();
    await heading();
    expect(screen.getByTestId("mrn")).toHaveTextContent("2026-000301");
    expect(screen.getByText(/41 yrs · Female/)).toBeInTheDocument();
    // The patient is Active, and so is the problem listed below.
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    const allergies = await screen.findByRole("list", { name: "Allergies" });
    expect(allergies).toHaveTextContent("Penicillin");
    expect(allergies).toHaveTextContent("Severe");

    const tabs = within(screen.getByRole("tablist", { name: "Patient chart" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Overview",
      "Vitals",
      "Diagnoses",
      "Notes",
      "Prescriptions",
      "Tests and scans",
      "Billing",
      "Documents",
    ]);
  });

  it("shows the patient's tests and scans with their results on their own tab", async () => {
    renderChart();
    await heading();
    await userEvent.click(screen.getByRole("tab", { name: "Tests and scans" }));
    const card = await screen.findByText("Full blood count");
    const item = card.closest("li") as HTMLElement;
    expect(item).toHaveTextContent("13.1 g/dL");
    expect(item).toHaveTextContent("Reviewed by a doctor.");
  });

  it("shows the latest vital signs with change since last time and flags out-of-range values", async () => {
    renderChart();
    await heading();
    await within(await screen.findByRole("list", { name: "Latest vital signs" })).findByText(
      "150/95",
    );
    const bp = tile("Blood pressure");
    expect(bp).toHaveTextContent("150/95");
    expect(bp).toHaveTextContent("High");
    expect(bp).toHaveTextContent("up since the reading before");
    expect(tile("Heart rate")).toHaveTextContent("112");
    expect(tile("Heart rate")).toHaveTextContent("High");
    expect(tile("Temperature")).toHaveTextContent("36.8");
    expect(tile("Temperature")).not.toHaveTextContent("High");
    expect(tile("Oxygen saturation")).toHaveTextContent("98");
    expect(tile("BMI")).toHaveTextContent("24.2");
  });

  it("does not flag children's readings, and says why", async () => {
    chart.patient.date_of_birth = "2015-03-03";
    renderChart();
    await heading();
    await within(await screen.findByRole("list", { name: "Latest vital signs" })).findByText(
      "150/95",
    );
    expect(tile("Heart rate")).not.toHaveTextContent("High");
    expect(screen.getByText(/not flagged for patients under 18/)).toBeInTheDocument();
  });

  it("shows the visits, active problems, current medicines and allergies", async () => {
    renderChart();
    await heading();
    const visits = await screen.findByRole("region", { name: "Visits" });
    expect(await within(visits).findByText("Outpatient visit")).toBeInTheDocument();
    expect(visits).toHaveTextContent("Finished");
    expect(visits).toHaveTextContent("Antenatal visit");
    const problems = screen.getByRole("region", { name: "Active problems" });
    expect(await within(problems).findByText("Gestational hypertension")).toBeInTheDocument();
    expect(problems).toHaveTextContent("Confirmed");
    const medicines = screen.getByRole("region", { name: "Current medications" });
    expect(await within(medicines).findByText("Methyldopa 250 mg tablet")).toBeInTheDocument();
    const allergies = screen.getByRole("region", { name: "Allergies" });
    expect(await within(allergies).findByText("Hives")).toBeInTheDocument();
  });

  it("starts a visit, then offers the visit's quick actions", async () => {
    renderChart();
    await heading();
    expect(screen.queryByRole("navigation", { name: /Quick actions/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Start visit" }));
    const dialog = await screen.findByRole("dialog", { name: "Start visit" });
    await userEvent.type(
      within(dialog).getByLabelText("Reason for the visit"),
      "Fever and body aches",
    );
    await userEvent.click(await within(dialog).findByRole("button", { name: "Start visit" }));

    const bar = await screen.findByRole("navigation", { name: "Quick actions for this visit" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Record vitals", "Add diagnosis", "Write note", "Prescribe"]);
    expect(calls("encounters")[0].body).toMatchObject({
      patient: CHART_PATIENT,
      encounter_class: "outpatient",
      reason: "Fever and body aches",
    });
    expect(await screen.findByTestId("current-visit")).toHaveTextContent(
      "Outpatient visit in progress",
    );

    await userEvent.click(screen.getByRole("button", { name: "Finish visit" }));
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: /Quick actions/ })).not.toBeInTheDocument(),
    );
  });

  it("gives roles that do not run visits no visit, allergy or quick actions", async () => {
    resetChartMocks({ visit: true });
    renderChart("pharmacist");
    await heading();
    await screen.findByRole("region", { name: "Visits" });
    expect(
      screen.queryByRole("button", { name: /Start visit|Finish visit/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add allergy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /Quick actions/ })).not.toBeInTheDocument();
  });

  it("says when the patient is not found", async () => {
    renderChart("doctor", "8a5e2f8c-0000-4000-8000-00000000ffff");
    expect(await screen.findByText("This patient could not be found.")).toBeInTheDocument();
  });
});

describe("vital signs", () => {
  it("records a set from the quick actions: shows BMI as it will be calculated, and the server's refusal", async () => {
    resetChartMocks({ visit: true });
    renderChart();
    await heading();
    const bar = await screen.findByRole("navigation", { name: "Quick actions for this visit" });
    await userEvent.click(within(bar).getByRole("button", { name: "Record vitals" }));
    const dialog = await screen.findByRole("dialog", { name: "Record vital signs" });

    const type = (label: string, text: string) =>
      userEvent.type(within(dialog).getByLabelText(label), text);
    await type("Heart rate (/min)", "96");
    await type("Body temperature (Cel)", "55");
    await type("Body weight (kg)", "64");
    await type("Body height (cm)", "160");
    expect(within(dialog).getByText("25.0 kg/m²")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Body mass index/)).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Save readings" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("outside 30 to 45");

    await userEvent.clear(within(dialog).getByLabelText("Body temperature (Cel)"));
    await type("Body temperature (Cel)", "38.4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save readings" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Record vital signs" })).not.toBeInTheDocument(),
    );
    expect(calls("vitals").at(-1)?.body).toMatchObject({
      encounter: "8a5e2f8c-0000-4000-8000-0000000004e1",
      readings: expect.arrayContaining([{ code: "8310-5", value: "38.4" }]),
    });
    // The newest set now leads the tiles.
    await waitFor(() => expect(tile("Temperature")).toHaveTextContent("38.4"));
    expect(tile("Temperature")).toHaveTextContent("High");
  });

  it("shows history and a trend on the Vitals tab, and hides a set marked as entered in error with an undo", async () => {
    undoConfig.delayMs = 2500; // long enough to reach Undo on a slow host
    renderChart();
    await heading();
    await openTab("Vitals");
    const card = await screen.findByRole("region", { name: "Vital signs" });
    expect(
      await within(card).findByRole("figure", { name: /Systolic blood pressure over time/ }),
    ).toBeInTheDocument();
    const grid = await within(card).findByRole("table", { name: "Vital signs, most recent first" });
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
    expect(grid).toHaveTextContent("150/95 (high)");

    const newest = within(grid).getAllByRole("row")[1];
    await userEvent.click(within(newest).getByRole("button", { name: /Actions for the readings/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Entered in error" }));
    const dialog = await screen.findByRole("dialog", { name: /vital signs as entered in error/ });
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), "Wrong patient");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as entered in error" }));

    // Hidden at once, with a way back; nothing is sent yet.
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(2));
    expect(calls("vitals/v2/entered-in-error")).toHaveLength(0);
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(calls("vitals/v2/entered-in-error")).toHaveLength(0);
  });
});

describe("diagnoses", () => {
  it("lists the problem list with status pills", async () => {
    renderChart();
    await heading();
    await openTab("Diagnoses");
    const grid = await screen.findByRole("table", { name: "Current diagnoses" });
    const row = await within(grid).findByRole("row", { name: /Gestational hypertension/ });
    expect(row).toHaveTextContent("O13");
    expect(row).toHaveTextContent("Active");
    expect(row).toHaveTextContent("Confirmed");
  });

  it("adds a diagnosis from an ICD-10 search, and needs a date when it is marked resolved", async () => {
    resetChartMocks({ visit: true });
    renderChart();
    await heading();
    await openTab("Diagnoses");
    const card = await screen.findByRole("region", { name: "Problem list" });
    await userEvent.click(within(card).getByRole("button", { name: "Add diagnosis" }));
    const dialog = await screen.findByRole("dialog", { name: "Add diagnosis" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Add diagnosis" }));
    expect(within(dialog).getByText("Choose a diagnosis code.")).toBeInTheDocument();

    await userEvent.type(
      within(dialog).getByRole("combobox", { name: /Search ICD-10/ }),
      "malaria",
    );
    await userEvent.click(await screen.findByRole("option", { name: "B54 Unspecified malaria" }));
    await choose(within(dialog), "Clinical status", "Resolved");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add diagnosis" }));
    expect(within(dialog).getByText("Give the date the condition resolved.")).toBeInTheDocument();
    expect(calls("diagnoses")).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText("Date resolved"), "2026-10-10");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add diagnosis" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add diagnosis" })).not.toBeInTheDocument(),
    );
    expect(calls("diagnoses")[0].body).toMatchObject({
      code: "B54",
      clinical_status: "resolved",
      abatement_date: "2026-10-10",
    });
    // Resolved diagnoses sit under "Past and refuted".
    expect(await screen.findByTestId("past-diagnoses")).toHaveTextContent("Past and refuted (1)");
  });

  it("changes a diagnosis's status; a refuted one leaves the problem list", async () => {
    renderChart();
    await heading();
    await openTab("Diagnoses");
    const grid = await screen.findByRole("table", { name: "Current diagnoses" });
    await userEvent.click(
      await within(grid).findByRole("button", { name: "Actions for Gestational hypertension" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Update status" }));
    const dialog = await screen.findByRole("dialog", { name: "Update Gestational hypertension" });
    await choose(within(dialog), "Verification", "Refuted");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save status" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Update Gestational/ })).not.toBeInTheDocument(),
    );
    expect(calls("diagnoses/d1")[0].body).toMatchObject({ verification_status: "refuted" });
    expect(await screen.findByTestId("past-diagnoses")).toHaveTextContent("Past and refuted (1)");
  });

  it("hides a diagnosis marked as entered in error after the undo window, sending the reason", async () => {
    undoConfig.delayMs = 300;
    renderChart();
    await heading();
    await openTab("Diagnoses");
    const grid = await screen.findByRole("table", { name: "Current diagnoses" });
    await userEvent.click(
      await within(grid).findByRole("button", { name: "Actions for Gestational hypertension" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Entered in error" }));
    const dialog = await screen.findByRole("dialog", { name: /diagnosis as entered in error/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as entered in error" }));
    expect(within(dialog).getByText("Give a reason.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), "Wrong patient");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as entered in error" }));

    await waitFor(() =>
      expect(screen.queryByRole("table", { name: "Current diagnoses" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("No current diagnoses.")).toBeInTheDocument();
    await waitFor(() => expect(calls("diagnoses/d1/entered-in-error")).toHaveLength(1));
    expect(calls("diagnoses/d1/entered-in-error")[0].body).toEqual({ reason: "Wrong patient" });
  });
});

describe("notes", () => {
  it("writes a note, closes and signs it, and then offers an addendum, not an edit", async () => {
    resetChartMocks({ visit: true });
    renderChart();
    await heading();
    const bar = await screen.findByRole("navigation", { name: "Quick actions for this visit" });
    await userEvent.click(within(bar).getByRole("button", { name: "Write note" }));
    const dialog = await screen.findByRole("dialog", { name: "New consultation note" });
    expect(within(dialog).getByRole("button", { name: "Save note" })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Subjective"), "Three days of fever");
    await userEvent.type(within(dialog).getByLabelText("Plan"), "Malaria RDT");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save note" }));

    const note = await screen.findByTestId("note");
    expect(note).toHaveTextContent("Three days of fever");
    expect(within(note).getByTestId("note-status")).toHaveTextContent("Open");
    await userEvent.click(within(note).getByRole("button", { name: "Close and sign" }));
    await waitFor(() =>
      expect(within(screen.getByTestId("note")).getByTestId("note-status")).toHaveTextContent(
        "Closed",
      ),
    );
    expect(
      within(screen.getByTestId("note")).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(screen.getByTestId("note")).getByRole("button", { name: "Add addendum" }),
    );
    const addendum = await screen.findByRole("dialog", { name: "Addendum" });
    await userEvent.type(within(addendum).getByLabelText("Assessment"), "RDT positive");
    await userEvent.click(within(addendum).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.getAllByTestId("note")).toHaveLength(2));
    expect(calls("notes").at(-1)?.body).toMatchObject({
      addendum_to: expect.any(String),
      assessment: "RDT positive",
    });
  });
});

describe("allergies", () => {
  it("adds an allergy, which then appears in the banner, and hides one marked as entered in error", async () => {
    undoConfig.delayMs = 300;
    renderChart();
    await heading();
    const card = await screen.findByRole("region", { name: "Allergies" });
    await userEvent.click(await within(card).findByRole("button", { name: "Add allergy" }));
    const dialog = await screen.findByRole("dialog", { name: "Add allergy" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add allergy" }));
    expect(within(dialog).getByText("Name the substance.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Substance"), "Latex");
    await choose(within(dialog), "Category", "Environment");
    await userEvent.type(within(dialog).getByLabelText("Reaction"), "Contact rash");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add allergy" }));

    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Allergies" })).toHaveTextContent("Latex"),
    );
    expect(calls("allergies")[0].body).toMatchObject({
      substance: "Latex",
      category: "environment",
      severity: "moderate",
    });

    await userEvent.click(
      within(card).getByRole("button", { name: "Actions for the Latex allergy" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Entered in error" }));
    const reason = await screen.findByRole("dialog", { name: /allergy as entered in error/ });
    await userEvent.type(
      within(reason).getByLabelText(/^Reason/),
      "Recorded for the wrong patient",
    );
    await userEvent.click(within(reason).getByRole("button", { name: "Mark as entered in error" }));
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Allergies" })).not.toHaveTextContent("Latex"),
    );
    await waitFor(() => expect(calls("allergies/a100/entered-in-error")).toHaveLength(1));
  });
});

describe("access", () => {
  it("shows each section's own no-access message and no data when the API refuses it", async () => {
    for (const group of ["vitals", "diagnoses", "prescriptions", "allergies", "encounters"]) {
      chart.forbidden.add(group);
    }
    renderChart("admin");
    await heading();
    await waitFor(() => expect(screen.getAllByText(/^No access to/)).toHaveLength(5));
    expect(screen.queryByText("Penicillin")).not.toBeInTheDocument();
    expect(screen.queryByText("Gestational hypertension")).not.toBeInTheDocument();
    // The banner has no allergy list when the API refuses allergies.
    expect(screen.queryByRole("list", { name: "Allergies" })).not.toBeInTheDocument();
  });

  it("shows the Audit tab only to roles that may read the audit log", async () => {
    const { unmount } = renderChart("doctor");
    await heading();
    expect(screen.queryByRole("tab", { name: "Audit" })).not.toBeInTheDocument();
    unmount();

    renderChart("admin");
    await heading();
    await openTab("Audit");
    const grid = await screen.findByRole("table", { name: "Record access, most recent first" });
    expect(await within(grid).findByText("Doctor Tester")).toBeInTheDocument();
    expect(grid).toHaveTextContent("Allowed");
  });

  it("explains a refused patient record", async () => {
    chart.forbidden.add("patient");
    renderChart();
    expect(
      await screen.findByRole("heading", {
        name: "You do not have access to this patient's record",
      }),
    ).toBeInTheDocument();
  });
});
