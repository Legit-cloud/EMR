import { expect, test } from "@playwright/test";

import { apiPost, authFile, lettersFrom, loadSeed, totp } from "./helpers";

const seed = loadSeed();

test.describe("sign-in", () => {
  test("password then authenticator code", async ({ page }) => {
    const user = seed.users.login;
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Username").fill(user.username);
    await page.getByLabel("Password").fill(seed.password);
    await page.getByRole("button", { name: "Continue" }).click();
    const code = page.getByLabel("Authenticator code");
    await expect(code).toBeFocused();
    await code.fill(totp(user.totp_key));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();
    await expect(page.getByTestId("signed-in-user")).toHaveText("Login Tester");
  });
});

test.describe("front desk", () => {
  test.use({ storageState: authFile("desk") });

  test("registers a new patient with the wizard", async ({ page }) => {
    const suffix = lettersFrom(seed.run);
    await page.goto("/patients");
    await page.getByRole("button", { name: "New patient" }).click();
    const wizard = page.getByRole("dialog", { name: "Register a patient" });
    await wizard.getByLabel("First name").fill(`Chiamaka${suffix}`);
    await wizard.getByLabel("Last name").fill(`Okoro${suffix}`);
    await wizard.getByLabel("Date of birth").fill("1999-09-09");
    // Enter moves to the next step; only the last step submits.
    await wizard.getByLabel("Last name").press("Enter");
    await wizard.getByLabel(/^Phone/).fill("0803 555 0101");
    await wizard.getByRole("button", { name: "Next" }).click();
    await expect(wizard.getByText("Allergies are recorded by clinical staff")).toBeVisible();
    await wizard.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Chiamaka${suffix}`);
    await expect(page.getByTestId("mrn")).toHaveText(/^\d{4}-\d{6}$/);
  });

  test("is warned about a likely duplicate as they type and can send it for review", async ({
    page,
  }) => {
    // The old registration address still works: it opens the wizard.
    await page.goto("/patients/new");
    const wizard = page.getByRole("dialog", { name: "Register a patient" });
    await wizard.getByLabel("First name").fill("Ngozi");
    await wizard.getByLabel("Last name").fill("Eze");
    await wizard.getByLabel("Date of birth").fill("1985-06-01");
    const matches = wizard.getByRole("region", { name: "Possible matches" });
    await expect(matches).toContainText("This person may already be registered");
    await expect(matches).toContainText(seed.patient.mrn);
    await expect(matches).toContainText(/\d+% match/);
    await expect(
      matches.getByRole("link", { name: /Open existing record for Ngozi Eze/ }),
    ).toHaveAttribute("href", `/patients/${seed.patient.id}`);

    await wizard.getByRole("button", { name: "Next" }).click();
    await wizard.getByRole("button", { name: "Next" }).click();
    await wizard.getByRole("button", { name: "Send for review" }).click();
    await expect(wizard.getByText("Sent for review")).toBeVisible();
    await wizard.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/patients$/);
  });

  test("books an appointment and checks the patient in", async ({ page }) => {
    await page.goto("/schedule");
    await page.getByLabel("Date").fill(seed.booking_date);
    await page.getByRole("button", { name: "Book 08:00" }).click();
    const dialog = page.getByRole("dialog", { name: "Book 08:00" });
    await dialog.getByLabel("Find patient").fill("Ngozi");
    await dialog.getByRole("radio", { name: /Ngozi Eze/ }).check();
    await dialog.getByRole("button", { name: "Book appointment" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Appointment booked" })).toBeVisible();

    const row = page.getByTestId("appointment").filter({ hasText: "Ngozi Eze" });
    await expect(row.getByTestId("appointment-status")).toHaveText("Booked");
    await row.getByRole("button", { name: "Check in" }).click();
    await expect(row.getByTestId("appointment-status")).toHaveText("Checked in");
  });
});

test.describe("doctor", () => {
  test.use({ storageState: authFile("doctor") });

  test("finds a patient in the register, with the allergy visible at a glance", async ({
    page,
  }) => {
    await page.goto("/patients");
    // The top bar has a search too; this one belongs to the register.
    await page
      .getByRole("region", { name: "Patient register" })
      .getByRole("searchbox", { name: /Search patients/ })
      .fill("Ngozi");
    const row = page.getByRole("row", { name: /Ngozi Eze/ });
    await expect(row).toContainText(seed.patient.mrn);
    await expect(row).toContainText("Penicillin");
    await row.getByRole("link", { name: /Ngozi Eze/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ngozi");
  });

  test("reads the chart: allergies, vitals and diagnoses", async ({ page }) => {
    await page.goto(`/patients/${seed.patient.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ngozi");
    const allergies = page.getByRole("region", { name: "Allergies" });
    await expect(allergies).toContainText("Penicillin");
    await expect(allergies).toContainText("Severe");
    const problems = page.getByRole("region", { name: "Problem list" });
    await expect(problems).toContainText("I10");
    await expect(problems).toContainText("Essential (primary) hypertension");
    const vitals = page.getByRole("region", { name: "Vital signs" });
    await expect(vitals).toContainText("Systolic blood pressure: 148 mm[Hg]");
    await expect(vitals).toContainText("Body mass index: 22.9 kg/m2");
  });

  test("sees a check-in appear in the queue without reloading", async ({ page, playwright }) => {
    await page.goto("/queue");
    await expect(page.getByTestId("connection")).toHaveText("Live");
    await expect(page.getByText(seed.queued_patient)).toHaveCount(0);

    const desk = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: authFile("desk"),
    });
    const response = await apiPost(
      desk,
      `/api/scheduling/appointments/${seed.queued_appointment_id}/status/`,
      { status: "checked_in", cancellation_reason: "" },
    );
    expect(response.ok()).toBeTruthy();
    await desk.dispose();

    await expect(
      page.getByTestId("queue-entry").filter({ hasText: seed.queued_patient }),
    ).toBeVisible();
  });

  test("prescribes through the allergy alert with an override reason", async ({ page }) => {
    await page.goto(`/patients/${seed.patient.id}`);
    await page.getByRole("link", { name: "New prescription" }).click();
    await page.getByLabel("Medicine").selectOption({ label: "Amoxicillin 500 mg (Tablet)" });
    await page.getByLabel("Dose").fill("1 capsule");
    await page.getByLabel("Frequency").fill("three times daily");
    await page.getByRole("button", { name: "Save and sign" }).click();

    const dialog = page.getByRole("dialog", { name: "Safety check" });
    const alert = dialog.getByTestId("safety-alert");
    await expect(alert).toContainText("Penicillin");
    await expect(alert).toContainText("must override");
    const sign = dialog.getByRole("button", { name: "Override and sign" });
    await expect(sign).toBeDisabled();
    await dialog
      .getByLabel("Reason for overriding")
      .fill("Allergy history disputed; test dose supervised");
    await sign.click();

    await expect(
      page.getByRole("status").filter({ hasText: "Prescription Authorised" }),
    ).toBeVisible();
    await expect(page.getByText("Allergy history disputed; test dose supervised")).toBeVisible();
  });
});
