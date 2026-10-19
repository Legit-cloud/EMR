"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";

import { AUTH_LINK, AuthLayout } from "@/components/auth/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiError, ensureCsrfCookie } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

/** Why the user is back at sign-in, set by the app when it signs them out. */
const REASONS: Record<string, string> = {
  idle: "You were signed out after 15 minutes without activity.",
  expired: "Your session has ended. Sign in again to continue.",
  reset: "Your password has been changed. Sign in with the new one.",
};

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"password" | "otp">("password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);
  const notice = REASONS[search.get("reason") ?? ""];

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
        otpRef.current?.focus();
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
    router.replace(data?.mfa_enrolment_required ? "/mfa" : safeNext(search.get("next")));
  }

  function startOver() {
    setStep("password");
    setOtp("");
    setPassword("");
    setError(null);
  }

  return (
    <AuthLayout
      title={step === "otp" ? "Enter your code" : "Sign in"}
      intro={
        step === "otp" ? (
          <>
            Enter the 6-digit code from the authenticator app linked to{" "}
            <strong className="text-ink-900">{username}</strong>.
          </>
        ) : (
          "Sign in with your staff account."
        )
      }
      footer={
        step === "otp" ? (
          <button type="button" className={AUTH_LINK} onClick={startOver}>
            Use a different account
          </button>
        ) : (
          <Link href="/forgot-password" className={AUTH_LINK}>
            Forgot your password?
          </Link>
        )
      }
    >
      {notice && !error && <Banner live>{notice}</Banner>}
      {error && <Banner tone="danger" live title={error} />}
      <form onSubmit={submit} className="flex flex-col gap-4">
        {step === "password" ? (
          <>
            <Input
              label="Username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
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
          <Input
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
            className="tnum"
          />
        )}
        <Button type="submit" loading={busy}>
          {step === "otp" ? "Verify and sign in" : "Continue"}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Sign-in: password first, then the authenticator code when the account uses MFA. */
export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
