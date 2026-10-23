import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppointmentsPage from "@/app/portal/appointments/page";
import InvoicesPage from "@/app/portal/invoices/page";
import HomePage from "@/app/portal/page";
import PrescriptionsPage from "@/app/portal/prescriptions/page";
import ProfilePage from "@/app/portal/profile/page";
import ResultsPage from "@/app/portal/results/page";
import { PortalShell, PORTAL_NAV } from "@/components/portal/portal-shell";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  describeRange,
  explainMedicine,
  explainTest,
  plainFrequency,
  plainInstructions,
  RESULT_FLAG_TEXT,
} from "@/lib/plain-language";
import { checkPaymentAmount } from "@/lib/portal";
import { createQueryClient } from "@/lib/query";
import { resetAuthMocks } from "@/mocks/auth";
import { portal, resetPortalMocks, SLOT_ONE } from "@/mocks/portal";

vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ path: "/portal", search: "", replace: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/redirect", () => ({ redirectTo: redirect }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function renderAs(page: ReactElement, who = "chioma.patient") {
  resetAuthMocks(who);
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>{page}</TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetPortalMocks();
  nav.path = "/portal";
  nav.search = "";
  nav.replace.mockReset();
  redirect.mockReset();
});

describe("plain language", () => {
  it("says what a test is in everyday words, with a safe fallback", () => {
    expect(explainTest("Haemoglobin")).toMatch(/carries oxygen/);
    expect(explainTest("  chest X-ray ")).toMatch(/picture of your lungs/);
    expect(explainTest("Something unusual")).toBe("A test your doctor asked for.");
  });

  it("describes the usual range, in whole or in part", () => {
    expect(describeRange(12, 16, "g/dL")).toBe("The usual range is 12 to 16 g/dL.");
    expect(describeRange(null, 5.6, "mmol/L")).toBe("The usual level is up to 5.6 mmol/L.");
    expect(describeRange(3, null, "")).toBe("The usual level is at least 3.");
    expect(describeRange(null, null, "g/dL")).toBeNull();
  });

  it("never diagnoses: out-of-range results hand the meaning to the doctor", () => {
    for (const flag of ["low", "high", "abnormal"] as const) {
      expect(RESULT_FLAG_TEXT[flag].sentence).toMatch(/Your doctor will/);
    }
  });

  it("writes prescribing shorthand out in full", () => {
    expect(plainFrequency("TDS")).toBe("three times a day");
    expect(plainFrequency("bd")).toBe("twice a day");
    expect(plainFrequency("PRN")).toBe("only when you need it");
    expect(plainFrequency("every 8 hours")).toBe("every 8 hours");
    expect(
      plainInstructions({ dose: "1 capsule", frequency: "TDS", route: "oral", duration_days: 5 }),
    ).toBe("Take 1 capsule three times a day, by mouth, for 5 days.");
    expect(
      plainInstructions({ dose: "2 tablets", frequency: "OD", route: "", duration_days: 1 }),
    ).toBe("Take 2 tablets once a day, for 1 day.");
  });

  it("says what a medicine is for, or sends the patient to the pharmacist", () => {
    expect(explainMedicine("Amoxicillin 500 mg")).toMatch(/antibiotic/);
    expect(explainMedicine("Unlisted drug 5 mg")).toBe(
      "Ask your pharmacist what this medicine is for.",
    );
  });
});

describe("home", () => {
  it("shows the next appointment, new results and the balance", async () => {
    renderAs(<HomePage />);
    expect(await screen.findByRole("heading", { name: "Hello, Chioma" })).toBeInTheDocument();
    const next = screen.getByRole("region", { name: "Your next appointment" });
    expect(next).toHaveTextContent("Dr Ada Okafor, Cardiology");
    const results = screen.getByRole("region", { name: "New results" });
    expect(results).toHaveTextContent("You have 2 new results to read.");
    const balance = screen.getByRole("region", { name: "Your balance" });
    expect(balance).toHaveTextContent("₦10,000.00");
    expect(within(balance).getByRole("link", { name: "See your bills" })).toHaveAttribute(
      "href",
      "/portal/invoices",
    );
  });

  it("refuses a member of staff the patient data", async () => {
    renderAs(<HomePage />, "ada.doctor");
    expect(await screen.findByText(/No access to home page/)).toBeInTheDocument();
    expect(screen.queryByText(/Hello,/)).toBeNull();
  });
});

describe("appointments", () => {
  it("lists what is coming up and past visits", async () => {
    renderAs(<AppointmentsPage />);
    const coming = await screen.findByRole("region", { name: "Coming up" });
    expect(coming).toHaveTextContent("Dr Ada Okafor, Cardiology");
    expect(coming).toHaveTextContent("Booked");
    expect(screen.getByRole("region", { name: "Past visits" })).toHaveTextContent("Completed");
  });

  it("books a free time with a reason", async () => {
    renderAs(<AppointmentsPage />);
    await screen.findByRole("region", { name: "Coming up" });
    await userEvent.click(screen.getByRole("button", { name: "Book a visit" }));
    const dialog = await screen.findByRole("dialog", { name: "Book a visit" });
    await userEvent.click(await within(dialog).findByRole("radio", { name: /Dr Chidi Eze/ }));
    await userEvent.type(
      within(dialog).getByLabelText("What is the visit for?"),
      "Persistent cough",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Book this visit" }));
    await waitFor(() => expect(portal.calls.at(-1)?.path).toBe("book"));
    expect(portal.calls.at(-1)?.body).toMatchObject({ reason: "Persistent cough" });
    expect(await screen.findByText("Visit booked")).toBeInTheDocument();
    expect(portal.slots.some((s) => s.doctor_name === "Dr Chidi Eze")).toBe(false);
  });

  it("asks for a time and a reason before booking", async () => {
    renderAs(<AppointmentsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Book a visit" }));
    const dialog = await screen.findByRole("dialog", { name: "Book a visit" });
    await within(dialog).findAllByRole("radio");
    await userEvent.click(within(dialog).getByRole("button", { name: "Book this visit" }));
    expect(await within(dialog).findByText("Choose a time.")).toBeInTheDocument();
    expect(within(dialog).getByText("Tell us briefly why you are coming.")).toBeInTheDocument();
    expect(portal.calls).toHaveLength(0);
    expect(SLOT_ONE).toBeTruthy();
  });

  it("cancels a visit with a reason", async () => {
    renderAs(<AppointmentsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /^Cancel the visit on/ }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this visit?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel visit" }));
    expect(await within(dialog).findByText("Tell us why you are cancelling.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Why are you cancelling?"), "Travelling");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel visit" }));
    await waitFor(() => expect(portal.appointments[0].status).toBe("cancelled"));
    expect(await screen.findByText("Visit cancelled")).toBeInTheDocument();
  });

  it("offers no cancel button on a past visit", async () => {
    renderAs(<AppointmentsPage />);
    const past = await screen.findByRole("region", { name: "Past visits" });
    expect(within(past).queryByRole("button", { name: /Cancel/ })).toBeNull();
  });
});

describe("results", () => {
  it("explains each test and marks new ones", async () => {
    renderAs(<ResultsPage />);
    const heading = await screen.findByRole("heading", { name: "Haemoglobin" });
    const card = heading.closest("section") as HTMLElement;
    expect(card).toHaveTextContent("protein in your blood that carries oxygen");
    expect(card).toHaveTextContent("New");
    expect(card).toHaveTextContent("A little low");
    expect(
      screen.getByRole("heading", { name: "Malaria parasite" }).closest("section"),
    ).not.toHaveTextContent("New");
  });

  it("reads a result with its usual range and no diagnosis, and marks it seen", async () => {
    renderAs(<ResultsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Read the Haemoglobin result" }),
    );
    expect(await screen.findByText("10.2")).toBeInTheDocument();
    expect(screen.getByText("The usual range is 12 to 16 g/dL.")).toBeInTheDocument();
    expect(screen.getByText(/Your doctor will tell you what it means for you/)).toBeInTheDocument();
    await waitFor(() => expect(portal.results[0].seen).toBe(true));
  });

  it("shows a scan report in plain words", async () => {
    renderAs(<ResultsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Read the Chest X-ray result" }),
    );
    expect(await screen.findByText(/Your lungs and heart look as expected/)).toBeInTheDocument();
  });
});

describe("prescriptions", () => {
  it("writes how to take each medicine out in full, and what it is for", async () => {
    renderAs(<PrescriptionsPage />);
    expect(await screen.findByText("Amoxicillin 500 mg")).toBeInTheDocument();
    expect(screen.getByText(/An antibiotic that fights infections/)).toBeInTheDocument();
    expect(
      screen.getByText("Take 1 capsule three times a day, by mouth, for 5 days."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Take 2 tablets only when you need it, by mouth, for 3 days."),
    ).toBeInTheDocument();
    expect(screen.getByText("Taking now")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    // No abbreviations left on the page.
    expect(screen.queryByText(/\bTDS\b|\bPRN\b/)).toBeNull();
  });
});

describe("invoices and paying online", () => {
  it("shows what each bill was for, what is paid and what is owed", async () => {
    renderAs(<InvoicesPage />);
    const owed = await screen.findByRole("region", { name: "Bill INV-1A5E2F8C" });
    expect(owed).toHaveTextContent("Chest X-ray");
    expect(owed).toHaveTextContent("Partially paid");
    expect(within(owed).getByLabelText("Still to pay on INV-1A5E2F8C")).toHaveTextContent(
      "₦10,000.00",
    );
    expect(screen.getByRole("region", { name: "Bill INV-3A5E2F8C" })).toHaveTextContent("Paid");
  });

  it("offers to pay only a bill that still has something owing, and names the other ways", async () => {
    renderAs(<InvoicesPage />);
    const owed = await screen.findByRole("region", { name: "Bill INV-1A5E2F8C" });
    expect(within(owed).getByRole("button", { name: "Pay bill INV-1A5E2F8C" })).toBeInTheDocument();
    expect(owed).toHaveTextContent("You can also pay at the cashier or by bank transfer");
    const paid = screen.getByRole("region", { name: "Bill INV-3A5E2F8C" });
    expect(within(paid).queryByRole("button", { name: /Pay bill/ })).toBeNull();
  });

  it("sends the patient to the Paystack page for the amount they chose, part or all", async () => {
    renderAs(<InvoicesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Pay bill INV-1A5E2F8C" }));
    const dialog = await screen.findByRole("dialog", { name: "Pay your bill" });
    const amount = within(dialog).getByLabelText(/^Amount/);
    expect(amount).toHaveValue("10000.00");
    await userEvent.clear(amount);
    await userEvent.type(amount, "4000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(portal.calls.at(-1)).toMatchObject({ path: "pay", body: { amount_minor: 400_000 } });
    expect(redirect.mock.calls[0][0]).toMatch(/^https:\/\/checkout\.paystack\.test\/emr_mock_/);
    // Starting a payment changes nothing on the bill.
    expect(portal.invoices[0].due_minor).toBe(1_000_000);
  });

  it("refuses more than is owed, or nothing, before anything is sent", async () => {
    renderAs(<InvoicesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Pay bill INV-1A5E2F8C" }));
    const dialog = await screen.findByRole("dialog", { name: "Pay your bill" });
    const amount = within(dialog).getByLabelText(/^Amount/);
    await userEvent.clear(amount);
    await userEvent.type(amount, "10000.01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to payment" }));
    expect(await within(dialog).findByText("You owe ₦10,000.00 on this bill.")).toBeInTheDocument();
    await userEvent.clear(amount);
    await userEvent.type(amount, "abc");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to payment" }));
    expect(await within(dialog).findByText("Enter an amount such as 1500.00.")).toBeInTheDocument();
    expect(portal.calls).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in the dialog and does not leave the page", async () => {
    renderAs(<InvoicesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Pay bill INV-1A5E2F8C" }));
    const dialog = await screen.findByRole("dialog", { name: "Pay your bill" });
    portal.invoices[0].due_minor = 0; // paid another way while the dialog was open
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to payment" }));
    expect(
      await within(dialog).findByText("You owe that much or less on this bill."),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("coming back from Paystack", () => {
  async function start(amount = 400_000) {
    resetAuthMocks("chioma.patient");
    const response = await fetch("http://localhost/api/portal/invoices/pi-1/pay/", {
      method: "POST",
      body: JSON.stringify({ amount_minor: amount }),
    });
    portal.calls.length = 0;
    return (await response.json()).reference as string;
  }

  it("asks the server and shows the bill updated when the payment went through", async () => {
    const reference = await start();
    portal.intents[reference].outcome = "paid";
    nav.path = "/portal/invoices";
    nav.search = `reference=${reference}&trxref=${reference}`;
    renderAs(<InvoicesPage />);
    expect(await screen.findByText("Payment received. Thank you.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Still to pay on INV-1A5E2F8C")).toHaveTextContent("₦6,000.00"),
    );
    expect(portal.calls.filter((c) => c.path === "verify")).toHaveLength(1);
    expect(nav.replace).toHaveBeenCalledWith("/portal/invoices", { scroll: false });
  });

  it("does not claim a payment that Paystack has not confirmed", async () => {
    const reference = await start();
    nav.search = `reference=${reference}`;
    renderAs(<InvoicesPage />);
    expect(
      await screen.findByText(/We have not been told about your payment yet/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Still to pay on INV-1A5E2F8C")).toHaveTextContent("₦10,000.00");
  });

  it("tells the patient when the billing office is checking the payment", async () => {
    const reference = await start();
    portal.intents[reference].outcome = "flagged";
    nav.search = `reference=${reference}`;
    renderAs(<InvoicesPage />);
    expect(
      await screen.findByText(/We received your payment and are checking it/),
    ).toBeInTheDocument();
  });

  it("shows nothing about payments when the patient simply opens the page", async () => {
    renderAs(<InvoicesPage />);
    await screen.findByRole("region", { name: "Bill INV-1A5E2F8C" });
    expect(screen.queryByText(/Payment received/)).toBeNull();
    expect(portal.calls.filter((c) => c.path === "verify")).toHaveLength(0);
  });
});

describe("payment amount rules", () => {
  it("accepts any amount up to what is owed, to the kobo", () => {
    expect(checkPaymentAmount("4000", 1_000_000, "NGN")).toEqual({ minor: 400_000 });
    expect(checkPaymentAmount("10,000.00", 1_000_000, "NGN")).toEqual({ minor: 1_000_000 });
    expect(checkPaymentAmount("0.01", 1_000_000, "NGN")).toEqual({ minor: 1 });
  });

  it("refuses nothing, text, too many decimals and more than is owed", () => {
    expect(checkPaymentAmount("0", 1_000_000, "NGN")).toEqual({
      error: "The amount must be more than zero.",
    });
    for (const text of ["", "abc", "-5", "1.005"]) {
      expect(checkPaymentAmount(text, 1_000_000, "NGN")).toEqual({
        error: "Enter an amount such as 1500.00.",
      });
    }
    expect(checkPaymentAmount("10000.01", 1_000_000, "NGN")).toEqual({
      error: "You owe ₦10,000.00 on this bill.",
    });
  });
});

describe("profile and consent", () => {
  it("shows the patient's details and each choice with its reason", async () => {
    renderAs(<ProfilePage />);
    expect(await screen.findByText("Chioma Nwosu")).toBeInTheDocument();
    expect(screen.getByText("2026-000207")).toBeInTheDocument();
    const email = screen.getByRole("checkbox", { name: "Email reminders" });
    expect(email).not.toBeChecked();
    expect(email).toHaveAccessibleDescription(/We email you the same reminders/);
  });

  it("saves a consent choice straight away", async () => {
    renderAs(<ProfilePage />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Email reminders" }));
    await waitFor(() => expect(portal.profile.consents.email_reminders).toBe(true));
    expect(portal.profile.consents.share_in_facility).toBe(true);
  });

  it("saves corrected contact details and refuses a phone number without a country code", async () => {
    renderAs(<ProfilePage />);
    const phone = await screen.findByLabelText("Phone number");
    await userEvent.clear(phone);
    await userEvent.type(phone, "08031234567");
    await userEvent.click(screen.getByRole("button", { name: "Save my details" }));
    expect(await screen.findByText(/with its country code/)).toBeInTheDocument();
    await userEvent.clear(phone);
    await userEvent.type(phone, "+2348031234567");
    await userEvent.click(screen.getByRole("button", { name: "Save my details" }));
    await waitFor(() => expect(portal.profile.phone).toBe("+2348031234567"));
  });
});

describe("the portal shell", () => {
  function shell(path: string) {
    nav.path = path;
    return render(
      <PortalShell name="Chioma Nwosu" onSignOut={vi.fn()}>
        <p>Content</p>
      </PortalShell>,
    );
  }

  it("has top navigation to every portal screen, with the current one marked", () => {
    shell("/portal/results");
    const links = within(screen.getByRole("navigation", { name: "Portal" })).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(PORTAL_NAV.map((n) => n.label));
    expect(screen.getByRole("link", { name: "Results" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("marks Home only on the home page", () => {
    shell("/portal");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("gives every control a 44 px touch target", () => {
    shell("/portal");
    const nav = screen.getByRole("navigation", { name: "Portal" });
    for (const link of within(nav).getAllByRole("link")) expect(link.className).toMatch(/min-h-11/);
    expect(screen.getByRole("button", { name: "Sign out" }).className).toMatch(/min-h-11/);
  });

  it("has a skip link and a main landmark", () => {
    shell("/portal");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveTextContent("Content");
  });
});
