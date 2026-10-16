"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Field, Notice } from "@/components/legacy-ui";
import { api, apiError } from "@/lib/api";

/** Authenticator set-up for users whose role requires MFA and who have no device yet. */
export default function MfaSetupPage() {
  const router = useRouter();
  const [configUrl, setConfigUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const { data, error: failure } = await api.POST("/api/accounts/auth/mfa/totp/enrol/");
    if (failure || !data) return setError(apiError(failure).message);
    setConfigUrl(data.config_url);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    const { error: failure } = await api.POST("/api/accounts/auth/mfa/totp/confirm/", {
      body: { token: code },
    });
    if (failure) return setError("That code is not valid. Try the current code.");
    router.replace("/patients");
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold">Set up your authenticator</h1>
      <p className="text-slate-700">
        Your role requires a second step at sign-in. Add this account to an authenticator app, then
        enter the code it shows.
      </p>
      {error && <Notice tone="error" title={error} />}
      {!configUrl ? (
        <Button onClick={start}>Start set-up</Button>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">
              Set-up key (enter it in your app, or open on this device)
            </p>
            <a href={configUrl} className="break-all text-sm text-teal-800 underline">
              {configUrl}
            </a>
          </div>
          <Field
            label="Code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <Button type="submit">Confirm</Button>
        </form>
      )}
    </div>
  );
}
