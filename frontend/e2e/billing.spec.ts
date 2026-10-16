import { expect, test } from "@playwright/test";

import { authFile, loadSeed } from "./helpers";

const seed = loadSeed();

test.use({ storageState: authFile("billing") });

// These run in order and share the seeded invoices.
test.describe.configure({ mode: "serial" });

test("views an invoice with lines, payments and what is still due", async ({ page }) => {
  await page.goto(`/invoices/${seed.invoice_id}`);
  await expect(page.getByTestId("payment-status")).toHaveText("Partially paid");
  const charges = page.getByRole("region", { name: "Charges" });
  await expect(charges).toContainText("Consultation with Dr Doctor Tester");
  await expect(charges).toContainText("Paracetamol");
  await expect(page.getByTestId("total")).toHaveText("₦10,300.00");
  await expect(page.getByTestId("paid")).toHaveText("₦5,000.00");
  await expect(page.getByTestId("net-due")).toHaveText("₦5,300.00");
});

test("adds a manual charge", async ({ page }) => {
  await page.goto(`/invoices/${seed.invoice_id}`);
  await expect(page.getByTestId("net-due")).toHaveText("₦5,300.00");
  await page.getByRole("button", { name: "Add charge" }).click();
  const dialog = page.getByRole("dialog", { name: "Add charge" });
  await dialog.getByLabel("Description").fill("Registration card");
  await dialog.getByLabel("Unit price (₦)").fill("2000");
  await dialog.getByRole("button", { name: "Add charge" }).click();
  await expect(page.getByRole("region", { name: "Charges" })).toContainText("Registration card");
  await expect(page.getByTestId("total")).toHaveText("₦12,300.00");
  await expect(page.getByTestId("net-due")).toHaveText("₦7,300.00");
});

test("takes the remaining payment and the invoice becomes paid", async ({ page }) => {
  await page.goto(`/invoices/${seed.invoice_id}`);
  await page.getByRole("button", { name: "Take payment" }).click();
  const dialog = page.getByRole("dialog", { name: "Take payment" });
  await expect(dialog.getByLabel("Amount (₦)")).toHaveValue("7300.00");
  await dialog.getByLabel("Method").selectOption("card");
  await dialog.getByLabel("Reference").fill("POS-4471");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("payment-status")).toHaveText("Paid");
  await expect(page.getByTestId("net-due")).toHaveText("₦0.00");
  await expect(page.getByRole("region", { name: "Payments" })).toContainText("ref POS-4471");
  await expect(page.getByRole("button", { name: "Take payment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add charge" })).toHaveCount(0);
});

test("splits a bill with an insurer and takes both shares", async ({ page }) => {
  await page.goto(`/invoices/${seed.uninsured_invoice_id}`);
  await page.getByRole("button", { name: "Insurer coverage" }).click();
  const coverage = page.getByRole("dialog", { name: "Insurer coverage" });
  await coverage.getByLabel("Insurer", { exact: true }).selectOption({ label: "E2E Health HMO" });
  await coverage.getByLabel("Insurer pays (%)").fill("80");
  await coverage.getByRole("button", { name: "Save coverage" }).click();
  await expect(page.getByTestId("insurer-due")).toHaveText("₦16,000.00");
  await expect(page.getByTestId("patient-due")).toHaveText("₦4,000.00");

  await page.getByRole("button", { name: "Take payment" }).click();
  const pay = page.getByRole("dialog", { name: "Take payment" });
  await pay.getByLabel("Paid by").selectOption("insurer");
  await expect(pay.getByLabel("Amount (₦)")).toHaveValue("16000.00");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("payment-status")).toHaveText("Partially paid");

  // Coverage is fixed once money has been received.
  await page.getByRole("button", { name: "Insurer coverage" }).click();
  await coverage.getByLabel("Insurer pays (%)").fill("50");
  await coverage.getByRole("button", { name: "Save coverage" }).click();
  await expect(coverage.getByRole("alert")).toContainText("Coverage is fixed");
  await coverage.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Take payment" }).click();
  await expect(pay.getByLabel("Amount (₦)")).toHaveValue("4000.00");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("payment-status")).toHaveText("Paid");
});

test("lists invoices by status", async ({ page }) => {
  await page.goto("/billing");
  await expect(page.getByRole("tab", { name: "Unpaid" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Paid", exact: true }).click();
  await expect(page.getByTestId("invoice-row").filter({ hasText: "Tolu Okafor" })).toHaveCount(1);
  await expect(page.getByTestId("invoice-row").filter({ hasText: "Bisi Lawal" })).toHaveCount(1);
  await page
    .getByTestId("invoice-row")
    .filter({ hasText: "Bisi Lawal" })
    .getByRole("link", { name: "Open" })
    .click();
  await expect(page.getByTestId("payment-status")).toHaveText("Paid");
});

test("adds an insurer", async ({ page }) => {
  await page.goto("/billing/insurers");
  await page.getByLabel("Name").fill("Synthetic Care HMO");
  await page.getByLabel("Short code").fill("synth-care");
  await page.getByRole("button", { name: "Add insurer" }).click();
  await expect(page.getByTestId("insurer").filter({ hasText: "Synthetic Care HMO" })).toBeVisible();
});
