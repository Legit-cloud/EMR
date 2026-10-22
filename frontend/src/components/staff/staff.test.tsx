import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StaffPage from "@/app/(app)/staff/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { licenceChip, roleLine } from "@/lib/staff";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { server } from "@/mocks/server";
import { resetStaffMocks, staffHandlers, staffMock } from "@/mocks/staff";

vi.setConfig({ testTimeout: 90_000 });

type Who = "hr" | "doctor";

const PEOPLE: Record<Who, { signedIn: string; me: Schemas["Me"] }> = {
  hr: { signedIn: "bisi.finance", me: MOCK_USERS["bisi.finance"] },
  doctor: { signedIn: "ada.doctor", me: MOCK_USERS["ada.doctor"] },
};

function renderPage(who: Who = "hr") {
  resetAuthMocks(PEOPLE[who].signedIn);
  // The appointments mock also answers this URL; these handlers take over for the staff tests.
  server.use(...staffHandlers);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={PEOPLE[who].me}>
            <StaffPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(resetStaffMocks);

const table = (name: string) => screen.findByRole("table", { name });
const rowOf = (t: HTMLElement, text: string) =>
  within(t).getByText(text).closest("tr") as HTMLElement;

describe("staff list", () => {
  it("shows the headcount and the Doctors and General staff tabs with their counts", async () => {
    renderPage();
    expect(await screen.findByText("6 staff")).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /Doctors\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /General staff\s*3/ })).toBeInTheDocument();
  });

  it("lists doctors with specialty, shift status and a licence chip", async () => {
    renderPage();
    const doctors = await table("Doctors");
    const ada = rowOf(doctors, "Dr Ada Okafor");
    expect(ada).toHaveTextContent("Cardiology");
    expect(ada).toHaveTextContent("On duty");
    expect(ada).toHaveTextContent(/Valid to/);
    expect(rowOf(doctors, "Dr Bola Adeyemi")).toHaveTextContent("Off duty");
    // Amber when the licence expires soon, pink once it has expired, with the date in words.
    expect(rowOf(doctors, "Dr Bola Adeyemi")).toHaveTextContent(/Expires \d{2} \w{3} \d{4}/);
    expect(rowOf(doctors, "Dr Chidi Eze")).toHaveTextContent(/Expired \d{2} \w{3} \d{4}/);
  });

  it("flags licences that need attention above the tabs", async () => {
    renderPage();
    expect(await screen.findByText(/need attention/)).toHaveTextContent(
      "1 expired and 1 expiring soon licences need attention.",
    );
  });

  it("lists general staff by role, and says when a licence is not required", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /General staff/ }));
    const general = await table("General staff");
    expect(rowOf(general, "Amaka Obi")).toHaveTextContent("Nurse / midwife");
    expect(rowOf(general, "Amaka Obi")).toHaveTextContent("On duty");
    expect(rowOf(general, "Ngozi Lawal")).toHaveTextContent("Not required");
    expect(within(general).queryByText("Dr Ada Okafor")).toBeNull();
  });

  it("searches by name, specialty or licence number", async () => {
    renderPage();
    await table("Doctors");
    await userEvent.type(screen.getByLabelText(/Search doctors/), "paed");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByText("Dr Bola Adeyemi")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Search doctors/));
    await userEvent.type(screen.getByLabelText(/Search doctors/), "nobody");
    expect(await screen.findByText("No staff match your search.")).toBeInTheDocument();
  });

  it("links HR and the tenant admin to the screen where staff and licences are managed", async () => {
    renderPage("hr");
    expect(await screen.findByRole("link", { name: "Manage staff and licences" })).toHaveAttribute(
      "href",
      "/manage/staff",
    );
  });

  it("gives a doctor the list but no management link", async () => {
    renderPage("doctor");
    await table("Doctors");
    expect(screen.queryByRole("link", { name: "Manage staff and licences" })).toBeNull();
  });

  it("tells someone who may not view staff that they have no access", async () => {
    staffMock.forbidden = true;
    renderPage("doctor");
    expect(await screen.findByRole("heading", { name: /do not have access/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("licence chip and role line", () => {
  const base = { licence_flag: "ok" as const, licence_expires_on: "2027-03-05" };

  it("words the chip by the watcher's state and keeps the date", () => {
    expect(licenceChip(base)).toMatchObject({ tone: "grey", label: "Valid to 05 Mar 2027" });
    expect(licenceChip({ ...base, licence_flag: "expiring" })).toMatchObject({
      tone: "amber",
      label: "Expires 05 Mar 2027",
    });
    expect(licenceChip({ ...base, licence_flag: "expired" })).toMatchObject({
      tone: "pink",
      label: "Expired 05 Mar 2027",
    });
  });

  it("shows no chip when there is no licence", () => {
    expect(licenceChip({ licence_flag: "ok", licence_expires_on: null })).toBeNull();
  });

  it("prefers the specialty to the staff type", () => {
    const profile = staffMock.profiles[0];
    expect(roleLine(profile)).toBe("Cardiology");
    expect(roleLine({ ...profile, specialty: "" })).toBe("Physician");
  });
});
