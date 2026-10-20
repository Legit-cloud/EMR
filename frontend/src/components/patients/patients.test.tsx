import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PatientsPage from "@/app/(app)/patients/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { MOCK_PATIENTS, patientMocks, resetPatientMocks } from "@/mocks/patients";

// These tests render a 25-row table and several refetches each; on this host a parallel
// run can be many times slower than a lone one.
vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/patients",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Who = "doctor" | "desk" | "pharmacist";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
  desk: { signedIn: "tunde.desk", me: MOCK_USERS["tunde.desk"] },
  pharmacist: {
    signedIn: "tunde.desk",
    me: {
      ...MOCK_USERS["tunde.desk"],
      roles: ["pharmacist"],
      assignments: [{ role: "pharmacist", facility: null, department: null }],
    },
  },
};

function renderPage(who: Who = "doctor", search = "") {
  nav.search = search;
  resetAuthMocks(PEOPLE[who].signedIn);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <PatientsPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  resetPatientMocks();
});

async function table() {
  return screen.findByRole("table", { name: "Patients" });
}

/** The visible patient names, in row order. */
function names() {
  return within(screen.getByRole("table", { name: "Patients" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent ?? "");
}

describe("patients register (mock layer)", () => {
  it("lists patients with the count, columns, status, allergies and last visit", async () => {
    renderPage();
    const grid = await table();
    expect(screen.getByRole("heading", { level: 1, name: "Patients" })).toBeInTheDocument();
    expect(screen.getByText("27 patients")).toBeInTheDocument();
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "",
      "Patient",
      "MRN",
      "Age and sex",
      "Phone",
      "Last visit",
      "Status",
      "Allergies",
      "Actions",
    ]);

    // Patient 4 (Emeka Ibrahim) has two allergies and a visit; patient 11 is inactive.
    const row = within(grid).getByRole("row", { name: /Emeka Ibrahim/ });
    expect(within(row).getByText("2026-000104")).toHaveClass("font-mono");
    expect(within(row).getByText(/Penicillin/)).toBeInTheDocument();
    expect(within(row).getByText("+1")).toBeInTheDocument();
    expect(within(row).getByText("Allergy:", { exact: false })).toHaveClass("sr-only");
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Emeka Ibrahim/ })).toHaveAttribute(
      "href",
      "/patients/8a5e2f8c-0000-4000-8000-000000000304",
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent("1–25 of 27");
  });

  it("searches by name after a short pause and says when nothing matches", async () => {
    renderPage();
    await table();
    const search = screen.getByRole("searchbox", { name: "Search patients by name, MRN or phone" });
    // No pause between keys: each one re-renders the register, which is slow under load.
    const typist = userEvent.setup({ delay: null });
    await typist.type(search, "adeyemi");
    await waitFor(() => expect(screen.getByText("5 patients")).toBeInTheDocument());
    expect(names().every((n) => n.includes("Adeyemi"))).toBe(true);

    await typist.clear(search);
    await typist.type(search, "zzzz");
    expect(await screen.findByText("No patients match your search.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(await screen.findByText("27 patients")).toBeInTheDocument();
    expect(search).toHaveValue("");
  });

  it("sorts by a header and reverses it, and goes back to the default order", async () => {
    renderPage();
    await table();
    const header = () => screen.getByRole("columnheader", { name: /Patient/ });
    await userEvent.click(within(header()).getByRole("button"));
    await waitFor(() => expect(header()).toHaveAttribute("aria-sort", "ascending"));
    await waitFor(() => expect(names()[0]).toContain("Adeyemi"));
    await userEvent.click(within(header()).getByRole("button"));
    await waitFor(() => expect(header()).toHaveAttribute("aria-sort", "descending"));
    await waitFor(() => expect(names()[0]).toContain("Okonkwo"));
    await userEvent.click(within(header()).getByRole("button"));
    await waitFor(() => expect(header()).toHaveAttribute("aria-sort", "none"));
  });

  it("filters by status and by allergy, and shows how many filters are on", async () => {
    renderPage();
    await table();
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Inactive" }));
    await waitFor(() => expect(screen.getByText("2 patients")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: "Clear filters" }));
    await userEvent.click(within(panel).getByRole("checkbox", { name: /recorded allergy/ }));
    await waitFor(() => expect(screen.getByText("6 patients")).toBeInTheDocument());
  });

  it("pages through the register and changes the page size", async () => {
    renderPage();
    await table();
    const bar = () => screen.getByRole("navigation", { name: "Pagination" });
    await userEvent.click(within(bar()).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(bar()).toHaveTextContent("26–27 of 27"));
    expect(names()).toHaveLength(2);

    await userEvent.click(within(bar()).getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(await screen.findByRole("option", { name: "10" }));
    await waitFor(() => expect(bar()).toHaveTextContent("1–10 of 27"));
  });

  it("selects rows, with select-all and a clear button", async () => {
    renderPage();
    const grid = await table();
    await userEvent.click(
      within(grid).getByRole("checkbox", { name: "Select all rows on this page" }),
    );
    expect(screen.getByText("25 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it("opens a chart from the row menu", async () => {
    renderPage();
    const grid = await table();
    const row = within(grid).getByRole("row", { name: /Emeka Ibrahim/ });
    await userEvent.click(within(row).getByRole("button", { name: "Actions for Emeka Ibrahim" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Open chart" }));
    expect(nav.push).toHaveBeenCalledWith("/patients/8a5e2f8c-0000-4000-8000-000000000304");
  });

  it("links to the duplicate review queue when registrations are waiting", async () => {
    renderPage();
    const badge = await screen.findByRole("link", { name: /2 to review/ });
    expect(badge).toHaveAttribute("href", "/registrations");
  });

  it("offers registration only to roles that register (the API enforces it too)", async () => {
    const { unmount } = renderPage("desk");
    await table();
    expect(screen.getByRole("button", { name: "New patient" })).toBeInTheDocument();
    unmount();
    renderPage("pharmacist");
    await table();
    expect(screen.queryByRole("button", { name: "New patient" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /to review/ })).not.toBeInTheDocument();
  });

  it("shows a clear message, and no rows, when the API refuses", async () => {
    patientMocks.mode = "forbidden";
    renderPage();
    expect(
      await screen.findByRole("heading", {
        name: "You do not have access to the patient register",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("explains a failed load and recovers on retry", async () => {
    patientMocks.mode = "error";
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Patients could not be loaded.");
    patientMocks.mode = "ok";
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await table()).toBeInTheDocument();
  });

  it("invites registration when the register is empty", async () => {
    patientMocks.mode = "empty";
    renderPage();
    expect(await screen.findByText("No patients registered yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New patient" })).toHaveLength(2);
  });
});

// -- the registration wizard ----------------------------------------------------------

const BAYO = MOCK_PATIENTS[0]; // Bayo Adeyemi, born 1957-02-15

/** Optional fields add "(Optional)" to their label, so match on how it starts. */
async function type(label: string, text: string) {
  await userEvent.type(screen.getByLabelText(new RegExp(`^${label}`)), text);
}

function setDate(value: string) {
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value } });
}

async function fillIdentity(first: string, last: string, dob: string) {
  await type("First name", first);
  await type("Last name", last);
  setDate(dob);
}

/** Next inside the open wizard (the register behind it has a pagination "Next" too). */
const next = () =>
  userEvent.click(
    within(screen.getByRole("dialog", { name: "Register a patient" })).getByRole("button", {
      name: "Next",
    }),
  );

async function openWizard(who: Who = "doctor") {
  renderPage(who, "new=1");
  return screen.findByRole("dialog", { name: "Register a patient" });
}

describe("registration wizard (mock layer)", () => {
  it("opens from ?new=1 with three steps and closes back to the list", async () => {
    const dialog = await openWizard();
    const steps = within(dialog).getByRole("list", { name: "Progress" });
    expect(steps).toHaveTextContent("Identity, current step");
    expect(steps).toHaveTextContent("Contact, not started");
    expect(steps).toHaveTextContent("Allergies, not started");
    expect(within(dialog).getByLabelText("First name")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(nav.replace).toHaveBeenCalledWith("/patients");
  });

  it("blocks Next with inline errors until the step is valid", async () => {
    await openWizard();
    await next();
    expect(screen.getByText("First name is required.")).toBeInTheDocument();
    expect(screen.getByText("Last name is required.")).toBeInTheDocument();
    expect(screen.getByText("Date of birth is required.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Phone/)).not.toBeInTheDocument();

    await type("First name", "Ada3");
    await type("Last name", "Eze");
    setDate("2999-01-01");
    await next();
    expect(
      screen.getByText("Use letters only, separated by single spaces, hyphens or apostrophes."),
    ).toBeInTheDocument();
    expect(screen.getByText("Date of birth cannot be in the future.")).toBeInTheDocument();
  });

  it("accepts accents, hyphens and apostrophes and moves on", async () => {
    await openWizard();
    await fillIdentity("Zoë", "O'Neil-Ọlá", "1980-05-05");
    await next();
    expect(await screen.findByLabelText(/^Phone/)).toBeInTheDocument();
    expect(screen.getByLabelText("Country code")).toHaveTextContent("Nigeria (+234)");
  });

  it("does not check for duplicates until the identity is complete, nor on the last step", async () => {
    await openWizard();
    await type("First name", "Bayo");
    await type("Last name", "Adeyemi");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(patientMocks.checks).toBe(0);

    setDate(BAYO.date_of_birth);
    await screen.findByRole("region", { name: "Possible matches" });
    expect(patientMocks.checks).toBe(1);
    await next();
    await next();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(patientMocks.checks).toBe(1);
  });

  it("warns about a likely duplicate, offers the existing record, and sends it for review", async () => {
    const dialog = await openWizard();
    await fillIdentity("Bayo", "Adeyemi", BAYO.date_of_birth);
    const panel = await within(dialog).findByRole("region", { name: "Possible matches" });
    expect(panel).toHaveTextContent("This person may already be registered");
    expect(panel).toHaveTextContent("97% match");
    expect(panel).toHaveTextContent("Likely match");
    expect(panel).toHaveTextContent(BAYO.mrn);
    const link = within(panel).getByRole("link", { name: /Open existing record for Bayo Adeyemi/ });
    expect(link).toHaveAttribute("href", `/patients/${BAYO.id}`);
    expect(link).toHaveAttribute("target", "_blank");

    await next();
    await next();
    // Above 85% the last button says what will happen.
    await userEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    expect(await within(dialog).findByText("Sent for review")).toBeInTheDocument();
    expect(patientMocks.registered).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(nav.replace).toHaveBeenCalledWith("/patients");
  });

  it("shows weaker matches without holding the registration", async () => {
    const dialog = await openWizard();
    await fillIdentity("Ngozi", "Adeyemi", BAYO.date_of_birth);
    const panel = await within(dialog).findByRole("region", { name: "Possible matches" });
    expect(panel).toHaveTextContent("72% match");
    expect(panel).not.toHaveTextContent("Likely match");
    expect(panel).not.toHaveTextContent("may already be registered");
    await next();
    await next();
    expect(within(dialog).getByRole("button", { name: "Register patient" })).toBeInTheDocument();
  });

  it("registers a patient with a normalised phone and allergies, then opens the chart", async () => {
    const dialog = await openWizard();
    await fillIdentity("Zainab", "Musa", "1975-01-30");
    await next();
    await type("Phone", "0803 123 4567");
    await type("City", "Abuja");
    await next();

    await userEvent.click(within(dialog).getByRole("button", { name: "Add an allergy" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Register patient" }));
    expect(within(dialog).getByText("Name the substance.")).toBeInTheDocument();
    expect(within(dialog).getByText("Describe the reaction.")).toBeInTheDocument();

    await type("Substance", "Penicillin");
    await type("Reaction", "Hives");
    await userEvent.click(within(dialog).getByRole("button", { name: "Register patient" }));

    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/patients/8a5e2f8c-0000-4000-8000-000000000777"),
    );
    expect(patientMocks.registered).toHaveLength(1);
    expect(patientMocks.registered[0]).toMatchObject({
      first_name: "Zainab",
      last_name: "Musa",
      date_of_birth: "1975-01-30",
      phone: "+2348031234567",
      city: "Abuja",
      country: "NG",
      allergies: [
        {
          substance: "Penicillin",
          category: "medication",
          reaction: "Hives",
          severity: "moderate",
        },
      ],
    });
    expect(await screen.findByText("Patient registered")).toBeInTheDocument();
  });

  it("tells front desk allergies are recorded by clinical staff, and still registers", async () => {
    const dialog = await openWizard("desk");
    await fillIdentity("Zainab", "Musa", "1975-01-30");
    await next();
    await next();
    expect(
      within(dialog).getByText("Allergies are recorded by clinical staff"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Add an allergy" }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Register patient" }));
    await waitFor(() => expect(patientMocks.registered).toHaveLength(1));
    expect(patientMocks.registered[0].allergies).toEqual([]);
  });

  it("puts a rejection from the API next to its field, on the right step", async () => {
    const dialog = await openWizard();
    await fillIdentity("Rejected", "Person", "1990-01-01");
    await next();
    await next();
    await userEvent.click(within(dialog).getByRole("button", { name: "Register patient" }));
    expect(await within(dialog).findByLabelText(/^Phone/)).toBeInTheDocument();
    expect(
      within(dialog).getByText("Enter a phone number in international format."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Some details were not accepted");
  });

  it("submitting a step's form, as Enter does in a browser, moves to the next step", async () => {
    // user-event cannot press Enter for a submit button outside the <form> (the modal
    // footer); the browser journey in e2e covers the key itself.
    const dialog = await openWizard();
    await fillIdentity("Zainab", "Musa", "1975-01-30");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByLabelText(/^Phone/)).toBeInTheDocument();
  });
});
