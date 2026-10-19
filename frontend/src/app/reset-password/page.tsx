"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { AUTH_LINK, AuthLayout } from "@/components/auth/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiError, ensureCsrfCookie, fieldErrors } from "@/lib/api";

const MIN_LENGTH = 12;

function ResetForm() {
  const router = useRouter();
  const search = useSearchParams();
  const uid = search.get("uid") ?? "";
  const token = search.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<{ password?: string; repeat?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  if (!uid || !token) {
    return (
      <AuthLayout
        title="Reset link not valid"
        footer={
          <Link href="/forgot-password" className={AUTH_LINK}>
            Request a new link
          </Link>
        }
      >
        <Banner tone="danger" title="This link is incomplete.">
          Open the link from the email again, or request a new one.
        </Banner>
      </AuthLayout>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const local: typeof errors = {};
    if (password.length < MIN_LENGTH) local.password = `Use at least ${MIN_LENGTH} characters.`;
    if (repeat !== password) local.repeat = "The passwords do not match.";
    setErrors(local);
    if (local.password || local.repeat) return;

    setBusy(true);
    await ensureCsrfCookie();
    const { error: failure } = await api.POST("/api/accounts/auth/password-reset/confirm/", {
      body: { uid, token, new_password: password },
    });
    setBusy(false);
    if (!failure) {
      router.replace("/login?reason=reset");
      return;
    }
    const problem = apiError(failure);
    const fields = fieldErrors(problem);
    if (fields.new_password) {
      setErrors({ password: fields.new_password });
    } else {
      setErrors({
        form:
          problem.code === "throttled"
            ? "Too many attempts. Wait a minute and try again."
            : "This reset link has expired or has already been used. Request a new one.",
      });
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      intro={`Use at least ${MIN_LENGTH} characters. A short phrase is easier to remember.`}
      footer={
        <Link href="/login" className={AUTH_LINK}>
          Back to sign in
        </Link>
      }
    >
      {errors.form && <Banner tone="danger" live title={errors.form} />}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Repeat new password"
          name="repeat-password"
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          error={errors.repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <Button type="submit" loading={busy}>
          Set new password
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Password recovery, step 2: the link from the email carries uid and token. */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
