import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

test.use({ storageState: authFile("pharmacist") });

// These run in order: the second receives against the order the first places.
test.describe.configure({ mode: "serial" });

test("shows the stock header and inventory", async ({ page }) => {
  await page.goto("/pharmacy/stock");
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("Total asset value");
  await expect(overview).toContainText("Products");
  const table = page.getByRole("table", { name: "Inventory" });
  await expect(table).toContainText("Paracetamol 500 mg");
  await expect(table.getByRole("row").filter({ hasText: "Paracetamol" })).toContainText("In stock");
});

test("orders stock from a new vendor, which emails the order", async ({ page }) => {
  await page.goto("/pharmacy/stock?tab=orders");
  await page.getByRole("button", { name: "Order Stock" }).click();
  const wizard = page.getByRole("dialog", { name: "Order stock" });

  await wizard.getByRole("button", { name: "Add a vendor" }).click();
  await wizard.getByLabel("Vendor name").fill("E2E Medical Supplies");
  await wizard.getByLabel(/Vendor email/).fill("orders@e2e-supplies.example.test");
  await wizard.getByRole("button", { name: "Save vendor" }).click();
  await expect(wizard).toContainText("orders@e2e-supplies.example.test");
  await wizard.getByRole("button", { name: "Next" }).click();

  await wizard.getByRole("combobox", { name: "Drug" }).click();
  await page.getByRole("option", { name: /Paracetamol 500 mg/ }).click();
  await wizard.getByLabel("Quantity").fill("100");
  await wizard.getByLabel(/Unit cost/).fill("150");
  await wizard.getByRole("button", { name: "Add item" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();

  await expect(wizard.getByTestId("order-total")).toHaveText("₦15,000.00");
  await wizard.getByRole("button", { name: "Place order" }).click();
  await expect(wizard).toHaveCount(0);

  const row = page
    .getByRole("table", { name: "Orders" })
    .getByRole("row")
    .filter({ hasText: "E2E Medical Supplies" });
  await expect(row).toContainText("Pending");
  await expect(row).toContainText("1 item • ₦15,000.00");
  await expect(row.getByText(/Email sent/)).toBeVisible();
});

test("receives part of the order, then the rest", async ({ page }) => {
  await page.goto("/pharmacy/stock?tab=orders");
  const row = () =>
    page
      .getByRole("table", { name: "Orders" })
      .getByRole("row")
      .filter({ hasText: "E2E Medical Supplies" });

  await row()
    .getByRole("button", { name: /^Receive/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Receive stock" });
  const quantity = dialog.getByLabel(/^Quantity received/);
  await quantity.fill("40");
  await dialog.getByLabel(/^Batch number/).fill("E2E-PO-1");
  await dialog.getByLabel(/^Expiry date/).fill("2031-06-30");
  await dialog.getByRole("button", { name: "Receive stock" }).click();

  await expect(row()).toContainText("Partially received");
  await expect(row().getByRole("progressbar")).toHaveAttribute("aria-valuetext", "40 of 100");

  await row()
    .getByRole("button", { name: /^Receive/ })
    .click();
  await expect(quantity).toHaveValue("60");
  await dialog.getByLabel(/^Batch number/).fill("E2E-PO-1");
  await dialog.getByLabel(/^Expiry date/).fill("2031-06-30");
  await dialog.getByRole("button", { name: "Receive stock" }).click();

  await expect(row()).toContainText("Complete");
  await expect(row().getByRole("button", { name: /^Receive/ })).toBeDisabled();
});
