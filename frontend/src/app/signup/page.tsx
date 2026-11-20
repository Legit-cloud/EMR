"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { AUTH_LINK } from "@/components/auth/auth-layout";
import { SignupShell } from "@/components/signup/signup-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkSignup, type SignupErrors, signupMessage, useSignup } from "@/lib/onboarding";

/** Open an account for a hospital or clinic. The email is confirmed with a code next. */
export default function SignupPage() {
  const router = useRouter();
  const signup = useSignup();
  const [form, setForm] = useState({
    organisation_name: "",
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm: "",
    accepted_terms: false,
  });
  const [errors, setErrors] = useState<SignupErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found = checkSignup(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      const sent = await signup.mutateAsync({
        organisation_name: form.organisation_name.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        password: form.password,
        accepted_terms: form.accepted_terms,
      });
      router.push(`/signup/verify?email=${encodeURIComponent(sent.email)}`);
    } catch (failure) {
      setProblem(signupMessage(failure));
    }
  }

  return (
    <SignupShell
      title="Create your account"
      intro="For the person who manages the hospital or clinic. You can add your team after."
      footer={
        <Link href="/login" className={AUTH_LINK}>
          Already have an account? Sign in
        </Link>
      }
    >
      {problem && <Banner tone="danger" live title={problem} />}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Hospital or clinic name"
          name="organisation"
          autoComplete="organization"
          maxLength={200}
          value={form.organisation_name}
          error={errors.organisation_name}
          onChange={(e) => set({ organisation_name: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            name="first_name"
            autoComplete="given-name"
            value={form.first_name}
            error={errors.first_name}
            onChange={(e) => set({ first_name: e.target.value })}
          />
          <Input
            label="Last name"
            name="last_name"
            autoComplete="family-name"
            value={form.last_name}
            error={errors.last_name}
            onChange={(e) => set({ last_name: e.target.value })}
          />
        </div>
        <Input
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          hint="You will sign in with this address."
          value={form.email}
          error={errors.email}
          onChange={(e) => set({ email: e.target.value })}
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
          value={form.password}
          error={errors.password}
          onChange={(e) => set({ password: e.target.value })}
        />
        <Input
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          error={errors.confirm}
          onChange={(e) => set({ confirm: e.target.value })}
        />
        <div className="flex flex-col gap-1">
          <label className="text-body text-ink-700 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.accepted_terms}
              onChange={(e) => set({ accepted_terms: e.target.checked })}
            />
            <span>I accept the terms of use and the privacy notice for my organisation.</span>
          </label>
          {errors.accepted_terms && (
            <p role="alert" className="text-small text-pink-600">
              {errors.accepted_terms}
            </p>
          )}
        </div>
        <Button type="submit" loading={signup.isPending}>
          Create account
        </Button>
      </form>
    </SignupShell>
  );
}
