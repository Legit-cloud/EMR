import { expect, test, type Page } from "@playwright/test";

import { authFile, loadSeed } from "./helpers";

const seed = loadSeed();

test.use({ storageState: authFile("doctor") });

async function markEnteredInError(
  page: Page,
  row: ReturnType<Page["getByTestId"]>,
  reason: string,
) {
  await row.getByRole("button", { name: "Entered in error" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Mark as entered in error" }).click();
  await expect(dialog).toBeHidden();
}

test("a doctor runs a visit: vitals, diagnosis, allergy, notes, finish", async ({ page }) => {
  await page.goto(`/patients/${seed.queued_patient_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bisi");

  // Start the visit.
  await page.getByRole("button", { name: "Start visit" }).click();
  const start = page.getByRole("dialog", { name: "Start visit" });
  await start.getByLabel("Reason for the visit").fill("Fever and body aches");
  await start.getByRole("button", { name: "Start visit" }).click();
  await expect(page.getByTestId("current-visit")).toContainText("Outpatient visit in progress");

  // Vital signs: BMI is calculated by the server.
  await page.getByRole("button", { name: "Record vitals" }).click();
  const vitals = page.getByRole("dialog", { name: "Record vital signs" });
  await vitals.getByLabel("Heart rate (/min)").fill("96");
  await vitals.getByLabel("Body temperature (Cel)").fill("38.4");
  await vitals.getByLabel("Body weight (kg)").fill("64");
  await vitals.getByLabel("Body height (cm)").fill("160");
  await vitals.getByRole("button", { name: "Save readings" }).click();
  const vitalsCard = page.getByRole("region", { name: "Vital signs" });
  await expect(vitalsCard).toContainText("Heart rate: 96 /min");
  await expect(vitalsCard).toContainText("Body mass index: 25 kg/m2");

  // An implausible reading is refused with the server's reason.
  await page.getByRole("button", { name: "Record vitals" }).click();
  await vitals.getByLabel("Body temperature (Cel)").fill("55");
  await vitals.getByRole("button", { name: "Save readings" }).click();
  await expect(vitals.getByRole("alert")).toContainText("outside");
  await vitals.getByRole("button", { name: "Cancel" }).click();

  // Diagnosis from an ICD-10 search; confirm, then resolve with an abatement date.
  await page.getByRole("button", { name: "Add diagnosis" }).click();
  const add = page.getByRole("dialog", { name: "Add diagnosis" });
  await add.getByLabel("Search ICD-10 (code or words)").fill("malaria");
  await add.getByRole("radio", { name: /B54/ }).check();
  await add.getByRole("button", { name: "Add diagnosis" }).click();
  const diagnosis = page.getByTestId("diagnosis").filter({ hasText: "B54" });
  await expect(diagnosis).toContainText("Active, Unconfirmed");
  await diagnosis.getByRole("button", { name: "Confirm" }).click();
  await expect(diagnosis).toContainText("Active, Confirmed");
  await diagnosis.getByRole("button", { name: "Resolve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Resolve" }).click();
  await page.getByText(/Past and refuted/).click();
  await expect(page.getByTestId("diagnosis").filter({ hasText: "B54" })).toContainText(
    "Resolved, Confirmed",
  );

  // Allergy added, then corrected as entered in error.
  await page.getByRole("button", { name: "Add allergy" }).click();
  const allergy = page.getByRole("dialog", { name: "Add allergy" });
  await allergy.getByLabel("Substance").fill("Latex");
  await allergy.getByLabel("Category").selectOption("environment");
  await allergy.getByLabel("Reaction").fill("Contact rash");
  await allergy.getByRole("button", { name: "Add allergy" }).click();
  const latex = page.getByTestId("allergy").filter({ hasText: "Latex" });
  await expect(latex).toContainText("Moderate");
  await markEnteredInError(page, latex, "Recorded for the wrong patient");
  await expect(page.getByTestId("allergy").filter({ hasText: "Latex" })).toHaveCount(0);

  // Consultation note: write, close (sign), then add an addendum.
  await page.getByRole("button", { name: "Write note" }).click();
  const note = page.getByRole("dialog", { name: "New consultation note" });
  await note.getByLabel("Subjective").fill("Three days of fever");
  await note.getByLabel("Plan").fill("Malaria RDT, paracetamol");
  await note.getByRole("button", { name: "Save note" }).click();
  const written = page.getByTestId("note").filter({ hasText: "Three days of fever" });
  await expect(written.getByTestId("note-status")).toHaveText("Open");
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

  // Finish the visit.
  await page.getByRole("button", { name: "Finish visit" }).click();
  await expect(page.getByRole("button", { name: "Start visit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record vitals" })).toHaveCount(0);
});
