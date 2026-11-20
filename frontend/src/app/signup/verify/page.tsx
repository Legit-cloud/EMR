"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useRef, useState } from "react";

import { AUTH_LINK, AuthLayout } from "@/components/auth/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signupMessage, useResendCode, useVerifySignup } from "@/lib/onboarding";

const RESEND_SECONDS = 60;

function VerifyForm() {
  const router = useRouter();
  const email = useSearchParams().get("email") ?? "";
  const verify = useVerifySignup();
  const resend = useResendCode();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the email.");
    try {
      await verify.mutateAsync({ email, code });
      router.replace("/onboarding");
    } catch (failure) {
      setError(signupMessage(failure));
      setCode("");
      ref.current?.focus();
    }
  }

  async function sendAgain() {
    setError(null);
    setResent(false);
    try {
      await resend.mutateAsync(email);
      setResent(true);
      setWait(RESEND_SECONDS);
    } catch (failure) {
      setError(signupMessage(failure));
    }
  }

  if (!email) {
    return (
      <AuthLayout
        title="Start again"
        intro="We need your email address first."
        footer={
          <Link href="/signup" className={AUTH_LINK}>
            Create your account
          </Link>
        }
      >
        {null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Check your email"
      intro={
        <>
          We sent a 6-digit code to <strong className="text-ink-900">{email}</strong>. Enter it to
          confirm your email and open your account.
        </>
      }
      footer={
        <span className="flex flex-col items-center gap-2">
          <button
            type="button"
            className={AUTH_LINK}
            disabled={wait > 0 || resend.isPending}
            onClick={sendAgain}
          >
            {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
          </button>
          <Link href="/signup" className={AUTH_LINK}>
            Use a different email
          </Link>
        </span>
      }
    >
      {error && <Banner tone="danger" live title={error} />}
      {resent && !error && <Banner live>A new code is on its way.</Banner>}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          ref={ref}
          label="Verification code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="tnum"
        />
        <Button type="submit" loading={verify.isPending}>
          Verify and continue
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
