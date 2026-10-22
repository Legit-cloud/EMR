import { expect, type Locator, type Page, test } from "@playwright/test";

import { apiPost, authFile, emailedCode, lettersFrom, loadSeed, mailIdsFor } from "./helpers";

const seed = loadSeed();

/** The calendar on the seeded booking day, which has the physician's availability. */
async function openTomorrow(page: Page) {
  await page.goto("/appointments");
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.locator(`[data-column="${seed.physician_id}"]`)).toBeVisible();
}

/** Book Ngozi Eze at the calendar slot `offset` pixels below 08:00 (60px is one hour). */
async function bookAt(page: Page, offset: number) {
  await page
    .locator(`[data-column="${seed.physician_id}"]`)
    .click({ position: { x: 40, y: offset + 4 } });
  const wizard = page.getByRole("dialog", { name: "New appointment" });
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Find patient").fill("Ngozi");
  await page
    .getByRole("option", { name: /Ngozi Eze/ })
    .first()
    .click();
  await wizard.getByRole("button", { name: "Book appointment" }).click();
  await expect(wizard).toBeHidden();
}

/** Drag the named card with the mouse to `offset` pixels below the top of the column. */
async function dragTo(page: Page, name: RegExp, column: Locator, offset: number) {
  const card = page.getByRole("button", { name });
  const from = (await card.boundingBox())!;
  const body = (await column.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 10);
  await page.mouse.down();
  // The card is grabbed 10px down, so its top lands on the drop offset.
  await page.mouse.move(body.x + body.width / 2, body.y + offset + 10, { steps: 8 });
  await page.mouse.up();
}

test.describe("sign-in", () => {
  test("password then the emailed code", async ({ page }) => {
    const user = seed.users.login;
    const before = await mailIdsFor(user.email);
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Username").fill(user.username);
    await page.getByLabel("Password").fill(seed.password);
    await page.getByRole("button", { name: "Continue" }).click();
    const code = page.getByLabel("Sign-in code");
    await expect(code).toBeFocused();
    await code.fill(await emailedCode(user.email, before));
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

  test("books from an empty calendar slot and checks the patient in", async ({ page }) => {
    await openTomorrow(page);
    await bookAt(page, 0);
    await expect(page.getByRole("status").filter({ hasText: "Appointment booked" })).toBeVisible();

    await page.getByRole("button", { name: /Ngozi Eze, 08:00 to 08:15, Booked/ }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Checked-In" }).click();
    await expect(drawer.getByRole("combobox", { name: "Status" })).toHaveText("Checked-In");
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(
      page.getByRole("button", { name: /Ngozi Eze, 08:00 to 08:15, Checked-In/ }),
    ).toBeVisible();
  });

  test("drags an appointment to a free time, and is told when the time is taken", async ({
    page,
  }) => {
    await openTomorrow(page);
    await bookAt(page, 120);
    await bookAt(page, 240);
    const column = page.locator(`[data-column="${seed.physician_id}"]`);

    // Onto the 10:00 appointment: refused, in words, and nothing moves.
    await dragTo(page, /Ngozi Eze, 12:00 to 12:15/, column, 120);
    await expect(page.getByText(/already has an appointment at that time/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Ngozi Eze, 12:00 to 12:15/ })).toBeVisible();

    // To a free time: moved.
    await dragTo(page, /Ngozi Eze, 12:00 to 12:15/, column, 360);
    await expect(page.getByRole("button", { name: /Ngozi Eze, 14:00 to 14:15/ })).toBeVisible();
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

  test("reads the chart: allergies, vitals and problems", async ({ page }) => {
    await page.goto(`/patients/${seed.patient.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ngozi");
    // The banner keeps the allergy in view.
    await expect(page.getByRole("list", { name: "Allergies" }).first()).toContainText("Penicillin");
    const allergies = page.getByRole("region", { name: "Allergies" });
    await expect(allergies).toContainText("Penicillin");
    await expect(allergies).toContainText("Severe");
    const problems = page.getByRole("region", { name: "Active problems" });
    await expect(problems).toContainText("I10");
    await expect(problems).toContainText("Essential (primary) hypertension");
    const tiles = page.getByRole("list", { name: "Latest vital signs" });
    await expect(tiles.getByRole("listitem", { name: "Blood pressure" })).toContainText("148");
    await expect(tiles.getByRole("listitem", { name: "BMI" })).toContainText("22.9");
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

    const row = page.getByRole("row").filter({ hasText: seed.queued_patient });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /Start consultation/ })).toBeVisible();
  });

  test("prescribes through the allergy alert with an override reason", async ({ page }) => {
    await page.goto(`/patients/${seed.patient.id}`);
    await page.getByRole("button", { name: "Prescribe" }).click();
    const wizard = page.getByRole("dialog", { name: "New prescription" });
    await wizard.getByRole("combobox", { name: /Medicine 1/ }).click();
    await page.keyboard.type("Amox");
    await page.getByRole("option", { name: /Amoxicillin 500 mg/ }).click();
    await wizard.getByLabel(/Dose 1/).fill("1 capsule");
    await wizard.getByRole("combobox", { name: /Frequency 1/ }).click();
    await page.getByRole("option", { name: "Three times daily" }).click();
    await wizard.getByLabel(/Quantity to dispense 1/).fill("21");
    await wizard.getByRole("button", { name: "Next" }).click();

    // The seeded patient has a penicillin allergy: a blocking alert stops Sign.
    const check = wizard.getByRole("region", { name: "Safety check" });
    await expect(check).toContainText("Penicillin");
    const sign = wizard.getByRole("button", { name: "Sign prescription" });
    await expect(sign).toBeDisabled();
    await wizard.getByRole("combobox", { name: "Reason for overriding" }).click();
    await page.getByRole("option", { name: /No suitable alternative/ }).click();
    await expect(sign).toBeDisabled();
    await wizard.getByRole("checkbox", { name: /confirm the override/ }).check();
    await expect(sign).toBeEnabled();
    await sign.click();

    await expect(page.getByRole("status").filter({ hasText: "Prescription signed" })).toBeVisible();
    await page.getByRole("tab", { name: "Prescriptions" }).click();
    const table = page.getByRole("table", { name: /Prescriptions, most recent first/ });
    const row = table.getByRole("row").filter({ hasText: "Amoxicillin" });
    await expect(row).toContainText("Signed");
    // A signed prescription is never edited, only amended.
    await expect(row.getByRole("button", { name: "Create amended prescription" })).toBeVisible();
  });
});
