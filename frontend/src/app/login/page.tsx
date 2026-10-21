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
  const [resent, setResent] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);
  const notice = REASONS[search.get("reason") ?? ""];

  useEffect(() => {
    if (step === "otp") otpRef.current?.focus();
  }, [step]);

  /** Posting the password without a code makes the server email one. */
  async function submit(event?: FormEvent, withCode = step === "otp") {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setResent(false);
    await ensureCsrfCookie();
    const { error: failure } = await api.POST("/api/accounts/auth/login/", {
      body: {
        username,
        password,
        otp_token: withCode ? otp : undefined,
        mode: "session",
      },
    });
    setBusy(false);
    if (failure) {
      const problem = apiError(failure);
      if (problem.code === "mfa_required") {
        setStep("otp");
        setResent(!withCode && step === "otp");
        return;
      }
      if (problem.code === "invalid_otp") {
        setError(
          "That code is not valid or has expired. Use the latest email, or send a new code.",
        );
        setOtp("");
        otpRef.current?.focus();
        return;
      }
      if (problem.code === "no_email") {
        setError("This account has no email address for sign-in codes. Ask your administrator.");
        setStep("password");
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
    router.replace(safeNext(search.get("next")));
  }

  function startOver() {
    setStep("password");
    setOtp("");
    setPassword("");
    setError(null);
    setResent(false);
  }

  return (
    <AuthLayout
      title={step === "otp" ? "Enter your code" : "Sign in"}
      intro={
        step === "otp" ? (
          <>
            We emailed a 6-digit code to the address on the account{" "}
            <strong className="text-ink-900">{username}</strong>. It works for a few minutes.
          </>
        ) : (
          "Sign in with your staff account."
        )
      }
      footer={
        step === "otp" ? (
          <span className="flex flex-col items-center gap-2">
            <button
              type="button"
              className={AUTH_LINK}
              disabled={busy}
              onClick={() => submit(undefined, false)}
            >
              Send a new code
            </button>
            <button type="button" className={AUTH_LINK} onClick={startOver}>
              Use a different account
            </button>
          </span>
        ) : (
          <Link href="/forgot-password" className={AUTH_LINK}>
            Forgot your password?
          </Link>
        )
      }
    >
      {notice && !error && <Banner live>{notice}</Banner>}
      {error && <Banner tone="danger" live title={error} />}
      {resent && !error && <Banner live>If a new code was due, it is on its way.</Banner>}
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
            label="Sign-in code"
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

/** Sign-in: password first, then the one-time code emailed to the account. */
export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
