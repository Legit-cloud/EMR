import { expect, test, type Page } from "@playwright/test";

import { authFile, loadSeed } from "./helpers";

const seed = loadSeed();

test.use({ storageState: authFile("doctor") });

const quickActions = (page: Page) =>
  page.getByRole("navigation", { name: "Quick actions for this visit" });

async function choose(
  page: Page,
  scope: ReturnType<Page["getByRole"]>,
  label: string,
  option: string,
) {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("a doctor runs a visit: vitals, diagnosis, allergy, notes, finish", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/patients/${seed.queued_patient_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bisi");

  // Start the visit.
  await page.getByRole("button", { name: "Start visit" }).click();
  const start = page.getByRole("dialog", { name: "Start visit" });
  await start.getByLabel("Reason for the visit").fill("Fever and body aches");
  await start.getByRole("button", { name: "Start visit" }).click();
  await expect(page.getByTestId("current-visit")).toContainText("Outpatient visit in progress");
  await expect(quickActions(page)).toBeVisible();

  // Vital signs from the quick actions. BMI is calculated by the server.
  await quickActions(page).getByRole("button", { name: "Record vitals" }).click();
  const vitals = page.getByRole("dialog", { name: "Record vital signs" });
  await vitals.getByLabel("Heart rate (/min)").fill("96");
  await vitals.getByLabel("Body temperature (Cel)").fill("38.4");
  await vitals.getByLabel("Body weight (kg)").fill("64");
  await vitals.getByLabel("Body height (cm)").fill("160");
  await expect(vitals).toContainText("BMI will be recorded as 25.0 kg/m²");
  await vitals.getByRole("button", { name: "Save readings" }).click();
  const tiles = page.getByRole("list", { name: "Latest vital signs" });
  await expect(tiles.getByRole("listitem", { name: "Heart rate" })).toContainText("96");
  await expect(tiles.getByRole("listitem", { name: "Temperature" })).toContainText("38.4");
  await expect(tiles.getByRole("listitem", { name: "Temperature" })).toContainText("High");
  await expect(tiles.getByRole("listitem", { name: "BMI" })).toContainText("25.0");

  // An implausible reading is refused with the server's reason.
  await quickActions(page).getByRole("button", { name: "Record vitals" }).click();
  await vitals.getByLabel("Body temperature (Cel)").fill("55");
  await vitals.getByRole("button", { name: "Save readings" }).click();
  await expect(vitals.getByRole("alert")).toContainText("outside");
  await vitals.getByRole("button", { name: "Cancel" }).click();

  // Diagnosis from an ICD-10 search, then confirm it, then resolve it.
  await quickActions(page).getByRole("button", { name: "Add diagnosis" }).click();
  const add = page.getByRole("dialog", { name: "Add diagnosis" });
  await add.getByRole("combobox", { name: /Search ICD-10/ }).fill("malaria");
  await page.getByRole("option", { name: /B54/ }).click();
  await add.getByRole("button", { name: "Add diagnosis" }).click();
  await page.getByRole("tab", { name: "Diagnoses" }).click();
  const current = page.getByRole("table", { name: "Current diagnoses" });
  const row = current.getByRole("row", { name: /B54/ });
  await expect(row).toContainText("Unconfirmed");

  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Update status" }).click();
  const status = page.getByRole("dialog", { name: /^Update / });
  await choose(page, status, "Verification", "Confirmed");
  await status.getByRole("button", { name: "Save status" }).click();
  await expect(current.getByRole("row", { name: /B54/ })).toContainText("Confirmed");

  await current
    .getByRole("row", { name: /B54/ })
    .getByRole("button", { name: /^Actions for/ })
    .click();
  await page.getByRole("menuitem", { name: "Update status" }).click();
  await choose(page, status, "Clinical status", "Resolved");
  await expect(status.getByLabel("Date resolved")).toBeVisible();
  await status.getByRole("button", { name: "Save status" }).click();
  await page.getByTestId("past-diagnoses").click();
  await expect(
    page
      .getByRole("table", { name: "Past and refuted diagnoses" })
      .getByRole("row", { name: /B54/ }),
  ).toContainText("Resolved");

  // Allergy added, then corrected as entered in error (undo window, then it is sent).
  await page.getByRole("tab", { name: "Overview" }).click();
  const allergies = page.getByRole("region", { name: "Allergies" });
  await allergies.getByRole("button", { name: "Add allergy" }).click();
  const allergy = page.getByRole("dialog", { name: "Add allergy" });
  await allergy.getByLabel("Substance").fill("Latex");
  await choose(page, allergy, "Category", "Environment");
  await allergy.getByLabel("Reaction").fill("Contact rash");
  await allergy.getByRole("button", { name: "Add allergy" }).click();
  const latex = page.getByTestId("allergy").filter({ hasText: "Latex" });
  await expect(latex).toContainText("Moderate");
  await expect(page.getByRole("list", { name: "Allergies" }).first()).toContainText("Latex");

  await latex.getByRole("button", { name: "Actions for the Latex allergy" }).click();
  await page.getByRole("menuitem", { name: "Entered in error" }).click();
  const reason = page.getByRole("dialog", { name: /allergy as entered in error/ });
  await reason.getByLabel("Reason").fill("Recorded for the wrong patient");
  await reason.getByRole("button", { name: "Mark as entered in error" }).click();
  await expect(page.getByTestId("allergy").filter({ hasText: "Latex" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  // Consultation note: write, close (sign), then add an addendum.
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("button", { name: "Write note" }).first().click();
  const note = page.getByRole("dialog", { name: "New consultation note" });
  await note.getByLabel("Subjective").fill("Three days of fever");
  await note.getByLabel("Plan").fill("Malaria RDT, paracetamol");
  await note.getByRole("button", { name: "Save note" }).click();
  const written = page.getByTestId("note").filter({ hasText: "Three days of fever" });
  await expect(written.getByTestId("note-status")).toContainText("Open");
  await written.getByRole("button", { name: "Close and sign" }).click();
  await expect(written.getByTestId("note-status")).toContainText("Closed");
  await expect(written.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await written.getByRole("button", { name: "Add addendum" }).click();
  const addendum = page.getByRole("dialog", { name: "Addendum" });
  await addendum.getByLabel("Assessment").fill("RDT positive");
  await addendum.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByTestId("note").filter({ hasText: "RDT positive" })).toContainText(
    "Addendum",
  );

  // The allergy correction was sent once its undo window passed: it is gone after a reload.
  await page.waitForTimeout(6500);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bisi");
  // The address kept the Notes tab; the allergy card is on the Overview.
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("region", { name: "Allergies" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Allergies" })).not.toContainText("Latex");

  // Finish the visit.
  await page.getByRole("button", { name: "Finish visit" }).click();
  await expect(page.getByRole("button", { name: "Start visit" })).toBeVisible();
  await expect(quickActions(page)).toHaveCount(0);
});
