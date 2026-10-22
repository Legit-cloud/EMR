import { expect, test } from "@playwright/test";

import { authFile, lettersFrom, loadSeed } from "./helpers";

const seed = loadSeed();

test.describe("tenant admin", () => {
  test.use({ storageState: authFile("admin") });

  test("invites a user, scopes a role to a department, and deactivates them", async ({ page }) => {
    const username = `invited-${lettersFrom(seed.run)}`;
    await page.goto("/manage");
    await page.getByRole("button", { name: "Invite user" }).click();
    const invite = page.getByRole("dialog", { name: "Invite user" });
    await invite.getByLabel("Username").fill(username);
    await invite.getByLabel("Email").fill(`${username}@example.test`);
    await invite.getByLabel("First name").fill("Invited");
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "invited" })).toBeVisible();

    const row = page.getByTestId("user").filter({ hasText: username });
    await row.getByRole("button", { name: "Add role" }).click();
    const role = page.getByRole("dialog", { name: `Add role for ${username}` });
    await role.getByLabel("Role").selectOption("nurse");
    await role.getByLabel("Limited to department").selectOption({ label: "Medicine" });
    await role.getByRole("button", { name: "Add role" }).click();
    await expect(row.getByTestId("role")).toHaveText(/Nurse · Medicine/);

    await row.getByRole("button", { name: `Remove Nurse from ${username}` }).click();
    await expect(row.getByTestId("role")).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row).toContainText("Deactivated");
  });
});

test.describe("HR", () => {
  test.use({ storageState: authFile("hr") });

  test("adds a nurse's staff profile and records the licence check", async ({ page }) => {
    await page.goto("/manage/staff");
    await page.getByRole("button", { name: "Add staff profile" }).click();
    const dialog = page.getByRole("dialog", { name: "Add staff profile" });
    await dialog.getByLabel("User").selectOption({ label: "Amaka Newnurse" });
    await dialog.getByLabel("Staff type").selectOption("nurse");
    await dialog.getByLabel("Licence number").fill(`RN-${seed.run.slice(-6)}`);
    await dialog.getByLabel("Licence expires").fill("2029-12-31");
    await dialog.getByRole("button", { name: "Add profile" }).click();

    const row = page.getByTestId("staff-profile").filter({ hasText: "Amaka Newnurse" });
    await expect(row.getByTestId("verification")).toHaveText("Unverified");
    await row.getByRole("button", { name: "Record check" }).click();
    const check = page.getByRole("dialog", { name: /Licence check/ });
    await check.getByLabel("Register reference").fill("NMCN register search, entry 4471");
    await check.getByRole("button", { name: "Record check" }).click();
    await expect(row.getByTestId("verification")).toContainText("Verified");
  });
});

test.describe("compliance officer", () => {
  test.use({ storageState: authFile("compliance") });

  test("reviews a break-glass access and finds it in the audit log", async ({ page }) => {
    await page.goto("/compliance");
    const grant = page
      .getByTestId("grant")
      .filter({ hasText: "Covering the emergency department overnight" });
    await grant.getByRole("button", { name: "Review" }).click();
    const dialog = page.getByRole("dialog", { name: "Review break-glass access" });
    await dialog.getByLabel("Outcome").selectOption("inappropriate");
    await dialog.getByLabel("Note").fill("Patient was not in the emergency department");
    await dialog.getByRole("button", { name: "Record review" }).click();
    await expect(page.getByRole("status").filter({ hasText: "inappropriate" })).toBeVisible();

    await page.getByLabel("Show").selectOption("inappropriate");
    await expect(
      page.getByTestId("grant").filter({ hasText: "Patient was not in the emergency department" }),
    ).toBeVisible();

    await page.goto("/compliance/audit");
    await expect(page).toHaveURL(/\/admin\/audit/);
    await page
      .getByLabel(/Search the audit log/)
      .fill("Patient was not in the emergency department");
    const entries = page.getByRole("table", { name: "Entries" });
    await expect(entries.getByRole("row").nth(1)).toContainText("Break-glass review");
  });

  test("cannot manage users", async ({ page }) => {
    await page.goto("/manage");
    await expect(page.getByText("You do not have access to this information.")).toBeVisible();
  });
});
