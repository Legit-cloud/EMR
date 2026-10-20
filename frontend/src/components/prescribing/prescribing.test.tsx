import { QueryClientProvider } from "@tanstack/react-query";
import { configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PatientChart } from "@/components/chart/patient-chart";
import {
  PrescriptionWizard,
  type PrescriptionStart,
} from "@/components/prescribing/prescription-wizard";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OVERRIDE_REASONS } from "@/lib/prescribing";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { CHART_PATIENT, OPEN_VISIT, resetChartMocks } from "@/mocks/chart";
import { BLOCKING, pharmacy, resetPharmacyMocks, WARNING } from "@/mocks/pharmacy";

// A wizard with two steps, a server search and a signing dialog: allow for a slow, busy host.
vi.setConfig({ testTimeout: 90_000 });
// Saving the draft and running the check take two requests: wait longer than usual for the review.
configure({ asyncUtilTimeout: 30_000 });

vi.mock("next/navigation", () => ({
  usePathname: () => "/patients/8a5e2f8c-0000-4000-8000-0000000004aa",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=prescriptions"),
}));

function providers(children: React.ReactNode) {
  resetAuthMocks("ada.doctor");
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return (
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SessionContext.Provider value={MOCK_USERS["ada.doctor"]}>
            {children}
          </SessionContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>
  );
}

function renderWizard(start?: PrescriptionStart) {
  const onOpenChange = vi.fn();
  render(
    providers(
      <PrescriptionWizard
        open
        onOpenChange={onOpenChange}
        patientId={CHART_PATIENT}
        encounterId={OPEN_VISIT}
        start={start}
      />,
    ),
  );
  return { onOpenChange, dialog: screen.getByRole("dialog") };
}

beforeEach(() => {
  resetChartMocks({ visit: true });
  resetPharmacyMocks();
});

/** Fill the first medicine: Amoxicillin, 1 capsule, three times daily, 21 to dispense. */
async function fillAmoxicillin(dialog: HTMLElement) {
  const user = userEvent.setup();
  const form = within(dialog);
  await user.click(form.getByRole("combobox", { name: /Medicine 1/ }));
  await user.keyboard("Amox");
  // The search is on the server: wait until the list has narrowed, so it cannot change mid-click.
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  await user.click(await screen.findByRole("option", { name: /Amoxicillin 500 mg/ }));
  await user.type(form.getByLabelText(/Dose 1/), "1 capsule");
  await user.click(form.getByRole("combobox", { name: /Frequency 1/ }));
  await user.click(await screen.findByRole("option", { name: "Three times daily" }));
  await user.type(form.getByLabelText(/Quantity to dispense 1/), "21");
  return user;
}

/** Press Next and wait for the review; if it never comes, say what the dialog showed. */
async function next(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  try {
    await within(dialog).findByRole("list", { name: "Medicines to prescribe" });
  } catch {
    throw new Error(`Still on the medicines step. Dialog text: ${dialog.textContent}`);
  }
}

describe("prescription wizard (FR-5.x, SEC-09)", () => {
  it("stays on the medicines step with inline errors until the form is complete", async () => {
    const user = userEvent.setup();
    const { dialog } = renderWizard();
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("Choose the medicine.")).toBeVisible();
    expect(within(dialog).getByText("Enter the dose.")).toBeVisible();
    expect(within(dialog).getByText("Choose how often.")).toBeVisible();
    expect(within(dialog).getByText("Enter the quantity to dispense.")).toBeVisible();
    // Nothing was saved.
    expect(pharmacy.calls).toHaveLength(0);
  });

  it("reviews beside the patient's allergies and medicines, then signs when nothing is flagged", async () => {
    const { dialog, onOpenChange } = renderWizard();
    const user = await fillAmoxicillin(dialog);
    await next(user, dialog);

    const review = await within(dialog).findByRole("list", { name: "Medicines to prescribe" });
    expect(within(review).getByText(/Amoxicillin 500 mg/)).toBeVisible();
    const aside = within(dialog).getByRole("complementary", { name: "About the patient" });
    expect(await within(aside).findByText("Penicillin")).toBeVisible();
    expect(await within(aside).findByText(/Methyldopa 250 mg tablet/)).toBeVisible();
    expect(await within(dialog).findByText(/found nothing to flag/)).toBeVisible();

    const sign = within(dialog).getByRole("button", { name: "Sign prescription" });
    expect(sign).toBeEnabled();
    await user.click(sign);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(pharmacy.calls.map((c) => c.path.split("/")[0])).toEqual([
      "create",
      "check",
      "authorise",
    ]);
    expect(screen.getByText("Prescription signed")).toBeVisible();
  });

  it("disables Sign for a blocking alert until a reason is chosen and the override is confirmed", async () => {
    pharmacy.alerts = [BLOCKING];
    const { dialog } = renderWizard();
    const user = await fillAmoxicillin(dialog);
    await next(user, dialog);

    const sign = await within(dialog).findByRole("button", { name: "Sign prescription" });
    expect(within(dialog).getByText(BLOCKING.message)).toBeVisible();
    expect(sign).toBeDisabled();

    const confirm = within(dialog).getByRole("checkbox", { name: /confirm the override/ });
    // Nothing to confirm until a reason is chosen.
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole("combobox", { name: "Reason for overriding" }));
    await user.click(await screen.findByRole("option", { name: OVERRIDE_REASONS[2].label }));
    expect(sign).toBeDisabled();
    await user.click(confirm);
    await waitFor(() => expect(sign).toBeEnabled());

    await user.click(sign);
    await waitFor(() =>
      expect(pharmacy.calls.find((c) => c.path.startsWith("authorise"))?.body).toEqual({
        overrides: { [BLOCKING.key]: OVERRIDE_REASONS[2].label },
      }),
    );
  });

  it("asks for a written reason of at least 15 characters when 'Other' is chosen", async () => {
    pharmacy.alerts = [BLOCKING];
    const { dialog } = renderWizard();
    const user = await fillAmoxicillin(dialog);
    await next(user, dialog);
    await user.click(
      await within(dialog).findByRole("combobox", { name: "Reason for overriding" }),
    );
    await user.click(await screen.findByRole("option", { name: /^Other/ }));
    const confirm = within(dialog).getByRole("checkbox", { name: /confirm the override/ });
    await user.type(within(dialog).getByLabelText("Your reason"), "too short");
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Your reason"), " but now long enough");
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await user.click(within(dialog).getByRole("button", { name: "Sign prescription" }));
    await waitFor(() =>
      expect(pharmacy.calls.find((c) => c.path.startsWith("authorise"))?.body).toEqual({
        overrides: { [BLOCKING.key]: "too short but now long enough" },
      }),
    );
  });

  it("shows a warning in amber and still lets the clinician sign", async () => {
    pharmacy.alerts = [WARNING];
    const { dialog } = renderWizard();
    const user = await fillAmoxicillin(dialog);
    await next(user, dialog);
    expect(await within(dialog).findByText(WARNING.message)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Sign prescription" })).toBeEnabled();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows new alerts and keeps the prescription unsigned when signing finds some", async () => {
    const { dialog, onOpenChange } = renderWizard();
    const user = await fillAmoxicillin(dialog);
    await next(user, dialog);
    const sign = await within(dialog).findByRole("button", { name: "Sign prescription" });
    // Between the preview and signing, the patient's record changed.
    pharmacy.alerts = [BLOCKING];
    await user.click(sign);
    expect(await within(dialog).findByText(/found new alerts/)).toBeVisible();
    expect(within(dialog).getByText(BLOCKING.message)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Sign prescription" })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pharmacy.prescriptions[0].status).toBe("draft");
  });

  it("starts an amended copy of a signed prescription, and cancels the original when it is signed", async () => {
    const original = pharmacy.prescriptions[0];
    const { dialog, onOpenChange } = renderWizard({ amend: original });
    expect(within(dialog).getByText("Amending a signed prescription")).toBeVisible();
    expect(within(dialog).getByLabelText(/Dose 1/)).toHaveValue("250 mg");
    const user = userEvent.setup();
    await next(user, dialog);
    await user.click(await within(dialog).findByRole("button", { name: "Sign prescription" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The original is cancelled, never edited.
    expect(pharmacy.calls.some((c) => c.path === "update/rx1")).toBe(false);
    expect(pharmacy.calls).toContainEqual({
      path: "cancel/rx1",
      body: { reason: "Replaced by an amended prescription" },
    });
    expect(original.status).toBe("cancelled");
  });

  it("carries on with a saved draft", async () => {
    const draft = { ...pharmacy.prescriptions[0], id: "rx-draft", status: "draft" as const };
    pharmacy.prescriptions.unshift(draft);
    const { dialog } = renderWizard({ draft });
    expect(within(dialog).getByLabelText(/Dose 1/)).toHaveValue("250 mg");
    const user = userEvent.setup();
    await next(user, dialog);
    await within(dialog).findByRole("button", { name: "Sign prescription" });
    // It updated the same draft instead of creating another one.
    expect(pharmacy.calls.map((c) => c.path)).toEqual(["update/rx-draft", "check/rx-draft"]);
  });
});

describe("prescriptions on the chart", () => {
  function renderChart() {
    resetAuthMocks("ada.doctor");
    return render(providers(<PatientChart id={CHART_PATIENT} />));
  }

  it("shows a signed prescription as signed, with no way to edit it, only an amended copy", async () => {
    const user = userEvent.setup();
    renderChart();
    const table = await screen.findByRole("table", { name: /Prescriptions, most recent first/ });
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByText("Signed", { selector: "span" })).toBeVisible();
    expect(within(row).queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Create amended prescription" }));
    const dialog = await screen.findByRole("dialog", { name: "Amended prescription" });
    expect(within(dialog).getByLabelText(/Dose 1/)).toHaveValue("250 mg");
  });
});
