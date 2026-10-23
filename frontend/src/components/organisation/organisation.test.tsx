import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DepartmentsPage from "@/app/(app)/departments/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Schemas } from "@/lib/api";
import { codeFrom } from "@/lib/organisation";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { server } from "@/mocks/server";

vi.setConfig({ testTimeout: 90_000 });

type Row = { id: string; name: string; code?: string; facility?: string };
const state: { facilities: Row[]; departments: Row[]; calls: { path: string; body: unknown }[] } = {
  facilities: [],
  departments: [],
  calls: [],
};

function reset() {
  state.facilities = [
    { id: "f1", name: "Main Hospital", code: "main-hospital" },
    { id: "f2", name: "Annex", code: "annex" },
  ];
  state.departments = [{ id: "d1", name: "Medicine", facility: "f1" }];
  state.calls = [];
  const list = (rows: Row[]) =>
    HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows });
  server.use(
    http.get("*/api/tenants/facilities/", () => list(state.facilities)),
    http.get("*/api/tenants/departments/", () => list(state.departments)),
    http.post("*/api/tenants/facilities/", async ({ request }) => {
      const body = (await request.json()) as Row;
      state.calls.push({ path: "facilities", body });
      const created = { ...body, id: `f${state.facilities.length + 1}` };
      state.facilities.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post("*/api/tenants/departments/", async ({ request }) => {
      const body = (await request.json()) as Row;
      state.calls.push({ path: "departments", body });
      const created = { ...body, id: `d${state.departments.length + 1}` };
      state.departments.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch("*/api/tenants/departments/:id/", async ({ params, request }) => {
      const body = (await request.json()) as Row;
      state.calls.push({ path: `departments/${params.id}`, body });
      const found = state.departments.find((d) => d.id === params.id)!;
      Object.assign(found, body);
      return HttpResponse.json(found);
    }),
  );
}

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
            <DepartmentsPage />
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(reset);

describe("facilities and departments", () => {
  it("lists each facility with its departments", async () => {
    renderPage();
    const list = await screen.findByRole("list", { name: "Departments of Main Hospital" });
    expect(within(list).getByText("Medicine")).toBeInTheDocument();
    expect(await screen.findByText("No departments yet.")).toBeInTheDocument();
  });

  it("adds a department to a facility", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add a department to Annex" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a department" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter the name.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Name"), "Surgery");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(state.calls[0]).toMatchObject({
        path: "departments",
        body: { name: "Surgery", facility: "f2" },
      }),
    );
  });

  it("adds a facility with a code made from its name", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add a facility" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a facility" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Lekki Clinic");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(state.calls[0]).toMatchObject({
        path: "facilities",
        body: { name: "Lekki Clinic", code: "lekki-clinic" },
      }),
    );
  });

  it("offers no editing to anyone but the administrator", async () => {
    renderPage("doctor");
    await screen.findByRole("list", { name: "Departments of Main Hospital" });
    expect(screen.queryByRole("button", { name: "Add a facility" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Rename/ })).toBeNull();
  });
});

describe("codeFrom", () => {
  it("makes a short address-safe code", () => {
    expect(codeFrom("Main Hospital")).toBe("main-hospital");
    expect(codeFrom("  Ọjọ́ Clinic (North) ")).toBe("o-jo-clinic-north");
    expect(codeFrom("x".repeat(60))).toHaveLength(32);
  });
});
