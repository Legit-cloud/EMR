"use client";

import { EnvelopeSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { AUTH_LINK, AuthLayout } from "@/components/auth/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiError, ensureCsrfCookie } from "@/lib/api";

/**
 * Password recovery, step 1. The answer is the same whether or not the address has an
 * account, so the page cannot be used to find out who works here.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    await ensureCsrfCookie();
    const { error: failure } = await api.POST("/api/accounts/auth/password-reset/", {
      body: { email },
    });
    setBusy(false);
    if (failure) {
      const problem = apiError(failure);
      setError(
        problem.code === "throttled"
          ? "Too many requests. Wait a minute and try again."
          : problem.code === "validation_error"
            ? "Enter a valid email address."
            : problem.message,
      );
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout
      title="Reset your password"
      intro={
        sent
          ? undefined
          : "Enter the email address on your staff account. We will send you a link to set a new password."
      }
      footer={
        <Link href="/login" className={AUTH_LINK}>
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Banner live title="Check your email">
          If <strong>{email}</strong> belongs to an account, a reset link is on its way. The link
          works once and expires after 24 hours.
        </Banner>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Banner tone="danger" live title={error} />}
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            icon={EnvelopeSimple}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
