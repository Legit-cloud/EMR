import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppLayout from "@/app/(app)/layout";
import OnboardingPage from "@/app/onboarding/page";
import SignupPage from "@/app/signup/page";
import VerifyPage from "@/app/signup/verify/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkSignup, missingAnswers, passwordProblem, toE164, toggle } from "@/lib/onboarding";
import { createQueryClient } from "@/lib/query";
import { resetAuthMocks } from "@/mocks/auth";
import {
  lastFinished,
  resends,
  resetOnboardingMocks,
  signups,
  startOnboarding,
} from "@/mocks/onboarding";

vi.setConfig({ testTimeout: 90_000 });

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function show(ui: React.ReactNode) {
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetOnboardingMocks();
  resetAuthMocks(null);
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.search = "";
});

describe("sign-up rules", () => {
  it("turns phone numbers into international form", () => {
    expect(toE164("08012345678")).toBe("+2348012345678");
    expect(toE164("0801 234 5678")).toBe("+2348012345678");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("12345")).toBeNull();
  });

  it("asks for a long password that is not all digits", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("123456789012345")).toMatch(/numbers/);
    expect(passwordProblem("a long synthetic phrase")).toBeNull();
  });

  it("checks every field of the form", () => {
    const form = {
      organisation_name: "S",
      first_name: "",
      last_name: "",
      email: "nope",
      password: "short",
      confirm: "",
      accepted_terms: false,
    };
    expect(Object.keys(checkSignup(form)).sort()).toEqual(
      [
        "accepted_terms",
        "email",
        "first_name",
        "last_name",
        "organisation_name",
        "password",
      ].sort(),
    );
    const good = {
      organisation_name: "Sunrise Clinic",
      first_name: "Ada",
      last_name: "Obi",
      email: "ada@example.test",
      password: "a long synthetic phrase",
      confirm: "a long synthetic phrase",
      accepted_terms: true,
    };
    expect(checkSignup(good)).toEqual({});
    expect(checkSignup({ ...good, confirm: "different" })).toHaveProperty("confirm");
  });

  it("lists what is still missing, and toggles list items", () => {
    expect(
      missingAnswers({ facility_name: "X", facility_type: "", phone: "", staff_band: "" } as never),
    ).toEqual(["the type of facility", "a phone number", "the number of staff"]);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sign-up page", () => {
  it("shows what is wrong before sending anything", async () => {
    show(<SignupPage />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Accept the terms to continue.")).toBeInTheDocument();
    expect(signups).toHaveLength(0);
  });

  it("sends the request and moves to the code step", async () => {
    show(<SignupPage />);
    await userEvent.type(screen.getByLabelText("Hospital or clinic name"), "Sunrise Clinic");
    await userEvent.type(screen.getByLabelText("First name"), "Ada");
    await userEvent.type(screen.getByLabelText("Last name"), "Obi");
    await userEvent.type(screen.getByLabelText(/Work email/), "ada@sunrise.example.test");
    await userEvent.type(
      screen.getByLabelText("Password", { exact: true }),
      "a long synthetic phrase",
    );
    await userEvent.type(screen.getByLabelText("Confirm password"), "a long synthetic phrase");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/signup/verify?email=ada%40sunrise.example.test"),
    );
    expect(signups[0].organisation_name).toBe("Sunrise Clinic");
  });
});

describe("verify page", () => {
  it("rejects a wrong code and clears the box", async () => {
    nav.search = "email=ada@sunrise.example.test";
    show(<VerifyPage />);
    await userEvent.type(screen.getByLabelText("Verification code"), "999999");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByText(/That code is not valid/)).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("goes to the onboarding questions on the right code", async () => {
    nav.search = "email=ada@sunrise.example.test";
    show(<VerifyPage />);
    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("makes you wait before asking for another code", async () => {
    nav.search = "email=ada@sunrise.example.test";
    show(<VerifyPage />);
    expect(screen.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
    expect(resends).toHaveLength(0);
  });

  it("asks for an email first when there is none", () => {
    show(<VerifyPage />);
    expect(screen.getByText("Start again")).toBeInTheDocument();
  });
});

describe("onboarding questions", () => {
  function open() {
    resetAuthMocks("bisi.finance");
    startOnboarding();
    return show(<OnboardingPage />);
  }

  it("is sent to sign in without a session", async () => {
    show(<OnboardingPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login?next=/onboarding"));
  });

  it("goes straight to the dashboard when there is nothing to answer", async () => {
    resetAuthMocks("bisi.finance");
    show(<OnboardingPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("asks for the required answers on the first step", async () => {
    open();
    await screen.findByText(/set up Sunrise Clinic/);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Choose the type of facility.")).toBeInTheDocument();
    expect(screen.getByText(/Enter a phone number/)).toBeInTheDocument();
  });

  it("walks the four steps, finishes and opens the dashboard", async () => {
    open();
    await screen.findByText(/set up Sunrise Clinic/);
    await userEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    await userEvent.type(screen.getByLabelText("Phone number"), "08012345678");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(
      await screen.findByRole("combobox", { name: "How many staff work there?" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "11 to 50" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(await screen.findByLabelText("Pharmacy"));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(await screen.findByLabelText("Billing and payments"));
    await userEvent.click(screen.getByRole("button", { name: "Finish and open dashboard" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(lastFinished).toBe(true);
  });

  it("can go back a step", async () => {
    open();
    await screen.findByText(/set up Sunrise Clinic/);
    await userEvent.click(screen.getByRole("radio", { name: /Hospital/ }));
    await userEvent.type(screen.getByLabelText("Phone number"), "08012345678");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const section = await screen.findByRole("region", { name: "Size" });
    await userEvent.click(within(section).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("region", { name: "Your facility" })).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveValue("08012345678");
  });
});

describe("the app after sign-up", () => {
  it("sends an administrator with unanswered questions to them first", async () => {
    resetAuthMocks("bisi.finance");
    startOnboarding();
    show(
      <AppLayout>
        <p>Dashboard content</p>
      </AppLayout>,
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Dashboard content")).toBeNull();
  });

  it("lets an organisation set up by hand straight in", async () => {
    resetAuthMocks("bisi.finance");
    show(
      <AppLayout>
        <p>Dashboard content</p>
      </AppLayout>,
    );
    expect(await screen.findByText("Dashboard content")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalledWith("/onboarding");
  });

  it("does not ask other staff to answer the administrator's questions", async () => {
    resetAuthMocks("ada.doctor");
    startOnboarding();
    show(
      <AppLayout>
        <p>Dashboard content</p>
      </AppLayout>,
    );
    expect(await screen.findByText("Dashboard content")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalledWith("/onboarding");
  });
});
