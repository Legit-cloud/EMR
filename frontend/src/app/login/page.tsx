"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, Field, Notice } from "@/components/legacy-ui";
import { api, apiError, ensureCsrfCookie } from "@/lib/api";

/** Sign-in: password first, then the authenticator code when the account uses MFA. */
export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"password" | "otp">("password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "otp") otpRef.current?.focus();
  }, [step]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    await ensureCsrfCookie();
    const { data, error: failure } = await api.POST("/api/accounts/auth/login/", {
      body: {
        username,
        password,
        otp_token: step === "otp" ? otp : undefined,
        mode: "session",
      },
    });
    setBusy(false);
    if (failure) {
      const problem = apiError(failure);
      if (problem.code === "mfa_required") {
        setStep("otp");
        return;
      }
      if (problem.code === "invalid_otp") {
        setError("That code is not valid. Enter the current code from your authenticator app.");
        setOtp("");
        return;
      }
      setError(
        problem.code === "throttled"
          ? "Too many attempts. Wait a minute and try again."
          : "The username or password is not correct.",
      );
      setStep("password");
      return;
    }
    // Drop anything cached while signed out, such as the "no session" answer.
    queryClient.clear();
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(
      data?.mfa_enrolment_required ? "/mfa" : next?.startsWith("/") ? next : "/dashboard",
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        aria-labelledby="login-title"
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 id="login-title" className="text-2xl font-semibold">
          Sign in
        </h1>
        {error && <Notice tone="error" title={error} />}
        {step === "password" ? (
          <>
            <Field
              label="Username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              Enter the 6-digit code from the authenticator app linked to{" "}
              <strong>{username}</strong>.
            </p>
            <Field
              ref={otpRef}
              label="Authenticator code"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            />
          </>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : step === "otp" ? "Verify and sign in" : "Continue"}
        </Button>
      </form>
    </main>
  );
}
