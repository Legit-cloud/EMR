import { expect, type Page, test } from "@playwright/test";

import { authFile, loadSeed } from "./helpers";

const seed = loadSeed();

test.use({ storageState: authFile("billing") });

// These run in order and share the seeded invoices.
test.describe.configure({ mode: "serial" });

/** Open an invoice in the billing screen's drawer. Old /invoices/<id> links land here too. */
async function openInvoice(page: Page, id: string) {
  await page.goto(`/invoices/${id}`);
  await expect(page).toHaveURL(new RegExp(`/billing\\?invoice=${id}`));
  const drawer = page.getByRole("dialog", { name: /^Invoice INV-/ });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("views an invoice with lines, payments and what is still due", async ({ page }) => {
  const drawer = await openInvoice(page, seed.invoice_id);
  await expect(drawer.getByTestId("payment-status")).toHaveText("Partially paid");
  const charges = drawer.getByRole("region", { name: "Charges" });
  await expect(charges).toContainText("Consultation with Dr Doctor Tester");
  await expect(charges).toContainText("Paracetamol");
  await expect(charges).toContainText("Prescription");
  await expect(drawer.getByTestId("total")).toHaveText("₦10,300.00");
  await expect(drawer.getByTestId("paid")).toHaveText("₦5,000.00");
  await expect(drawer.getByTestId("net-due")).toHaveText("₦5,300.00");
});

test("adds a manual charge", async ({ page }) => {
  const drawer = await openInvoice(page, seed.invoice_id);
  await expect(drawer.getByTestId("net-due")).toHaveText("₦5,300.00");
  await drawer.getByRole("button", { name: "Add charge" }).click();
  const dialog = page.getByRole("dialog", { name: "Add charge" });
  await dialog.getByLabel("Description").fill("Registration card");
  await dialog.getByLabel("Unit price (₦)").fill("2000");
  await dialog.getByRole("button", { name: "Add charge" }).click();
  await expect(drawer.getByRole("region", { name: "Charges" })).toContainText("Registration card");
  await expect(drawer.getByTestId("total")).toHaveText("₦12,300.00");
  await expect(drawer.getByTestId("net-due")).toHaveText("₦7,300.00");
});

test("takes part of what is due, then the remainder, and the invoice becomes paid", async ({
  page,
}) => {
  const drawer = await openInvoice(page, seed.invoice_id);
  await drawer.getByRole("button", { name: "Take payment" }).click();
  const dialog = page.getByRole("dialog", { name: "Take payment" });
  await expect(dialog.getByLabel("Amount (₦)")).toHaveValue("7300.00");

  // A part payment first: the invoice stays partly paid.
  await dialog.getByLabel("Amount (₦)").fill("2000");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(drawer.getByTestId("net-due")).toHaveText("₦5,300.00");
  await expect(drawer.getByTestId("payment-status")).toHaveText("Partially paid");

  await drawer.getByRole("button", { name: "Take payment" }).click();
  await expect(dialog.getByLabel("Amount (₦)")).toHaveValue("5300.00");
  await dialog.getByRole("combobox", { name: "Method" }).click();
  await page.getByRole("option", { name: "Card / POS" }).click();
  await dialog.getByLabel("Reference").fill("POS-4471");
  await dialog.getByRole("button", { name: "Record payment" }).click();

  await expect(drawer.getByTestId("payment-status")).toHaveText("Paid");
  await expect(drawer.getByTestId("net-due")).toHaveText("₦0.00");
  await expect(drawer.getByRole("button", { name: "Take payment" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Add charge" })).toHaveCount(0);
  await drawer.getByRole("tab", { name: "Payments" }).click();
  await expect(drawer.getByRole("region", { name: "Payments" })).toContainText("ref POS-4471");
});

test("will not take more than is owed", async ({ page }) => {
  const drawer = await openInvoice(page, seed.uninsured_invoice_id);
  await drawer.getByRole("button", { name: "Take payment" }).click();
  const dialog = page.getByRole("dialog", { name: "Take payment" });
  await dialog.getByLabel("Amount (₦)").fill("999999");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toContainText("Refunds are handled separately");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("splits a bill with an insurer and takes both shares", async ({ page }) => {
  const drawer = await openInvoice(page, seed.uninsured_invoice_id);
  await drawer.getByRole("button", { name: "Insurer coverage" }).click();
  const coverage = page.getByRole("dialog", { name: "Insurer coverage" });
  await coverage.getByRole("combobox", { name: "Insurer" }).click();
  await page.getByRole("option", { name: "E2E Health HMO" }).click();
  await coverage.getByLabel("Insurer pays (%)").fill("80");
  await coverage.getByRole("button", { name: "Save coverage" }).click();
  await expect(drawer.getByTestId("insurer-due")).toHaveText("₦16,000.00");
  await expect(drawer.getByTestId("patient-due")).toHaveText("₦4,000.00");

  await drawer.getByRole("button", { name: "Take payment" }).click();
  const pay = page.getByRole("dialog", { name: "Take payment" });
  await pay.getByRole("combobox", { name: "Paid by" }).click();
  await page.getByRole("option", { name: "Insurer" }).click();
  await expect(pay.getByLabel("Amount (₦)")).toHaveValue("16000.00");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(drawer.getByTestId("payment-status")).toHaveText("Partially paid");

  // Coverage is fixed once money has been received.
  await drawer.getByRole("button", { name: "Insurer coverage" }).click();
  await coverage.getByLabel("Insurer pays (%)").fill("50");
  await coverage.getByRole("button", { name: "Save coverage" }).click();
  await expect(coverage.getByRole("alert")).toContainText("Coverage is fixed");
  await coverage.getByRole("button", { name: "Cancel" }).click();

  await drawer.getByRole("button", { name: "Take payment" }).click();
  await expect(pay.getByLabel("Amount (₦)")).toHaveValue("4000.00");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(drawer.getByTestId("payment-status")).toHaveText("Paid");
});

test("lists invoices with totals, searches them and opens one", async ({ page }) => {
  await page.goto("/billing");
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("Billed");
  await expect(overview).toContainText("Collected");
  await expect(overview).toContainText("Still due");

  await page.getByLabel(/Search invoices/).fill("Bisi Lawal");
  const row = page.getByRole("row").filter({ hasText: "Bisi Lawal" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Paid");
  await row.getByRole("link", { name: /Open invoice/ }).click();
  const drawer = page.getByRole("dialog", { name: /^Invoice INV-/ });
  await expect(drawer.getByTestId("payment-status")).toHaveText("Paid");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toHaveCount(0);

  await page.getByLabel(/Search invoices/).fill("Tolu Okafor");
  await expect(page.getByRole("row").filter({ hasText: "Tolu Okafor" })).toHaveCount(1);
});

test("adds an insurer", async ({ page }) => {
  await page.goto("/billing/insurers");
  await page.getByLabel("Name").fill("Synthetic Care HMO");
  await page.getByLabel("Short code").fill("synth-care");
  await page.getByRole("button", { name: "Add insurer" }).click();
  await expect(page.getByTestId("insurer").filter({ hasText: "Synthetic Care HMO" })).toBeVisible();
});
