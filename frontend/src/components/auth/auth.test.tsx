import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ForgotPasswordPage from "@/app/forgot-password/page";
import LoginPage from "@/app/login/page";
import ResetPasswordPage from "@/app/reset-password/page";
import { ToastProvider } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { createQueryClient } from "@/lib/query";
import { safeNext } from "@/lib/safe-next";
import { MOCK_OTP, MOCK_PASSWORD, MOCK_PATIENT_ID, resetAuthMocks } from "@/mocks/auth";

import { BANNER_TEXT, breakGlassPatient, PatientAccessNotice } from "./break-glass";
import { IdleWarning } from "./idle-warning";
import { NoAccess } from "./no-access";

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => "/",
}));

function renderWithApp(ui: ReactNode) {
  const client = createQueryClient(vi.fn());
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockReset();
  resetAuthMocks();
});

async function enterPassword(username: string, password = MOCK_PASSWORD) {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("sign-in (mock layer)", () => {
  it("asks for the authenticator code after the password, then opens the next page", async () => {
    navigation.search = "next=/patients";
    renderWithApp(<LoginPage />);
    await enterPassword("ada.doctor");

    const code = await screen.findByLabelText("Authenticator code");
    expect(code).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Enter your code" })).toBeInTheDocument();
    await userEvent.type(code, MOCK_OTP);
    await userEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/patients"));
  });

  it("keeps the code step and explains a wrong code", async () => {
    renderWithApp(<LoginPage />);
    await enterPassword("ada.doctor");
    await userEvent.type(await screen.findByLabelText("Authenticator code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not valid");
    expect(screen.getByLabelText("Authenticator code")).toHaveValue("");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("does not say which of username or password was wrong", async () => {
    renderWithApp(<LoginPage />);
    await enterPassword("ada.doctor", "wrong-password-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The username or password is not correct.",
    );
  });

  it("sends accounts without an authenticator to set one up", async () => {
    renderWithApp(<LoginPage />);
    await enterPassword("tunde.desk");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/mfa"));
  });

  it("says why the user was signed out", () => {
    navigation.search = "reason=idle";
    renderWithApp(<LoginPage />);
    expect(screen.getByText(/signed out after 15 minutes without activity/)).toBeInTheDocument();
  });

  it("only follows same-site paths after sign-in", () => {
    expect(safeNext("/patients/1")).toBe("/patients/1");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("/\\evil.example")).toBe("/dashboard");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });
});

describe("password recovery", () => {
  it("confirms the request without saying whether the account exists", async () => {
    renderWithApp(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "If someone@example.test belongs to an account, a reset link is on its way.",
    );
  });

  it("rejects an incomplete link", () => {
    renderWithApp(<ResetPasswordPage />);
    expect(screen.getByRole("heading", { name: "Reset link not valid" })).toBeInTheDocument();
  });

  it("checks the new password locally before sending it", async () => {
    navigation.search = "uid=abc&token=valid-token";
    renderWithApp(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("Repeat new password"), "different");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("sets the password and returns to sign-in, or explains an expired link", async () => {
    navigation.search = "uid=abc&token=valid-token";
    const { unmount } = renderWithApp(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText("New password"), "a-long-new-passphrase");
    await userEvent.type(screen.getByLabelText("Repeat new password"), "a-long-new-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?reason=reset"));
    unmount();

    navigation.search = "uid=abc&token=used-token";
    renderWithApp(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText("New password"), "a-long-new-passphrase");
    await userEvent.type(screen.getByLabelText("Repeat new password"), "a-long-new-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expired or has already been used");
  });
});

describe("break-glass (SEC-02, SEC-03)", () => {
  it("offers break-glass for hidden records, requires a real reason, then shows the banner", async () => {
    resetAuthMocks("ada.doctor");
    renderWithApp(<PatientAccessNotice patientId={MOCK_PATIENT_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open with break-glass" }));

    const dialog = screen.getByRole("dialog", { name: "Open this chart with break-glass" });
    await userEvent.type(within(dialog).getByLabelText("Reason for access"), "emergency");
    await userEvent.click(within(dialog).getByRole("button", { name: "Open chart" }));
    expect(within(dialog).getByText(/Give a fuller reason/)).toBeInTheDocument();

    await userEvent.type(
      within(dialog).getByLabelText("Reason for access"),
      " - unconscious on arrival, history needed",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Open chart" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(BANNER_TEXT);
    expect(banner).toHaveTextContent(/Your extra access ends at/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("only tells roles that cannot break glass that some records are outside their access", async () => {
    resetAuthMocks("tunde.desk");
    renderWithApp(<PatientAccessNotice patientId={MOCK_PATIENT_ID} />);
    expect(
      await screen.findByText("Some of this patient's records are outside your access."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open with break-glass" })).not.toBeInTheDocument();
  });

  it("reads the patient to open from a break_glass_available refusal", () => {
    const refusal = new ApiRequestError(403, {
      code: "break_glass_available",
      message: "Outside your access.",
      details: { resource: "patients.patient", object_id: MOCK_PATIENT_ID },
    });
    expect(breakGlassPatient(refusal)).toBe(MOCK_PATIENT_ID);
    const plain = new ApiRequestError(403, {
      code: "permission_denied",
      message: "No.",
      details: {},
    });
    expect(breakGlassPatient(plain)).toBeNull();
  });
});

describe("IdleWarning", () => {
  it("counts down and lets the user stay or sign out", async () => {
    const onStay = vi.fn();
    const onSignOut = vi.fn();
    render(<IdleWarning deadline={Date.now() + 90_000} onStay={onStay} onSignOut={onSignOut} />);
    const dialog = screen.getByRole("dialog", { name: "Are you still there?" });
    expect(dialog).toHaveTextContent(/1:(29|30)/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Stay signed in" }));
    expect(onStay).toHaveBeenCalledOnce();
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign out now" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe("NoAccess", () => {
  it("explains the refusal and offers a way out, without any record data", () => {
    render(<NoAccess what="this patient's prescriptions" />);
    expect(
      screen.getByRole("heading", {
        name: "You do not have access to this patient's prescriptions",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
