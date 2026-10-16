import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

test.describe("pharmacist", () => {
  test.use({ storageState: authFile("pharmacist") });

  test("dispenses a signed prescription after the signature check", async ({ page }) => {
    await page.goto("/pharmacy");
    const waiting = page.getByTestId("to-dispense").filter({ hasText: "Ngozi Eze" });
    await expect(waiting).toContainText("0 of 18 given");
    await waiting.getByRole("button", { name: "Dispense" }).click();

    const dialog = page.getByRole("dialog", { name: "Dispense" });
    await expect(dialog).toContainText("Signature verified");
    await dialog.getByRole("button", { name: "Dispense" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Dispensed" })).toContainText(
      "now dispensed",
    );
    await expect(page.getByTestId("to-dispense").filter({ hasText: "Ngozi Eze" })).toHaveCount(0);
  });

  test("adds a medicine to the formulary and receives stock", async ({ page }) => {
    await page.goto("/pharmacy/formulary");
    await page.getByRole("button", { name: "Add medicine" }).click();
    const add = page.getByRole("dialog", { name: "Add medicine" });
    await add.getByLabel("Generic name").fill("Metronidazole");
    await add.getByLabel("Strength").fill("400 mg");
    await add.getByLabel("Active ingredients").fill("metronidazole");
    await add.getByLabel("Price per unit (₦)").fill("120.50");
    await add.getByRole("button", { name: "Add medicine" }).click();

    const card = page.getByRole("region", { name: "Metronidazole 400 mg (Tablet)" });
    await expect(card.getByTestId("drug-summary")).toHaveText("₦120.50 per unit · 0 available");
    await card.getByRole("button", { name: "Receive stock" }).click();
    const receive = page.getByRole("dialog", { name: "Receive Metronidazole" });
    await receive.getByLabel("Batch number").fill("MZ-0001");
    await receive.getByLabel("Expiry date").fill("2030-01-31");
    await receive.getByLabel("Quantity received").fill("100");
    await receive.getByRole("button", { name: "Receive" }).click();
    await expect(card.getByTestId("drug-summary")).toHaveText("₦120.50 per unit · 100 available");
    await expect(card).toContainText("MZ-0001");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: authFile("desk") });

  test("resolves a held registration as a duplicate of an existing patient", async ({ page }) => {
    await page.goto("/registrations");
    const review = page.getByTestId("review").filter({ hasText: "Ngozi Ezeh" });
    await review.getByRole("button", { name: "Review" }).click();
    const dialog = page.getByRole("dialog", { name: "Review Ngozi Ezeh" });
    await dialog.getByRole("radio", { name: /Same person as Ngozi Eze/ }).check();
    await dialog.getByLabel("Note").fill("Same NIN card shown at the desk");
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Linked to the existing patient" }),
    ).toBeVisible();
    await expect(page.getByTestId("review").filter({ hasText: "Ngozi Ezeh" })).toHaveCount(0);
  });
});
