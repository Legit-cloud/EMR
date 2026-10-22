import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InsurersPage from "@/app/(app)/billing/insurers/page";
import CompliancePage from "@/app/(app)/compliance/page";
import ManagePage from "@/app/(app)/manage/page";
import StaffPage from "@/app/(app)/manage/staff/page";
import FormularyPage from "@/app/(app)/pharmacy/formulary/page";
import PharmacyPage from "@/app/(app)/pharmacy/page";
import RegistrationsPage from "@/app/(app)/registrations/page";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { server } from "@/mocks/server";

vi.setConfig({ testTimeout: 60_000 });

/** A 500 from the server, in the API's error shape. */
const broken = () =>
  HttpResponse.json(
    { error: { code: "error", message: "Server error.", details: {} } },
    { status: 500 },
  );

const PAGES = [
  ["billing/insurers", "*/api/billing/insurers/", InsurersPage, "The insurers"],
  ["manage/staff", "*/api/staff/profiles/", StaffPage, "Staff profiles"],
  ["registrations", "*/api/patients/duplicate-reviews/", RegistrationsPage, "The registrations"],
  ["pharmacy/formulary", "*/api/pharmacy/drugs/", FormularyPage, "The formulary"],
  ["manage", "*/api/accounts/users/", ManagePage, "The user list"],
  ["pharmacy", "*/api/pharmacy/prescriptions/", PharmacyPage, "The dispensing list"],
  ["compliance", "*/api/accounts/break-glass/grants/", CompliancePage, "The break-glass list"],
] as const;

beforeEach(() => resetAuthMocks("bisi.finance"));

/** Every other list these pages ask for answers with nothing, so only the one under test fails. */
const EMPTY = [
  "*/api/accounts/users/",
  "*/api/accounts/role-assignments/",
  "*/api/tenants/facilities/",
  "*/api/tenants/departments/",
  "*/api/pharmacy/stock/",
  "*/api/pharmacy/prescriptions/",
];

describe("pages that have not moved to the new components yet (F15 states)", () => {
  it.each(PAGES)(
    "%s says the list could not be loaded, rather than showing it empty, and can retry",
    async (_name, url, Page, what) => {
      // The first handler listed wins, so the one under test goes first.
      server.use(
        http.get(url, broken),
        ...EMPTY.map((path) =>
          http.get(path, () =>
            HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
          ),
        ),
      );
      const client = createQueryClient(vi.fn());
      render(
        <QueryClientProvider client={client}>
          <SessionContext.Provider value={MOCK_USERS["bisi.finance"]}>
            <Page />
          </SessionContext.Provider>
        </QueryClientProvider>,
      );
      expect(await screen.findByText(`${what} could not be loaded.`)).toBeInTheDocument();
      expect(screen.queryByText(/Nothing|No registrations|no .* yet/i)).toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    },
  );
});
