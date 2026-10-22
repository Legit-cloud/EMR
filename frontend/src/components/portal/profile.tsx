"use client";

import { type FormEvent, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { FOCUS_RING } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import {
  CONSENTS,
  type ConsentKey,
  type PortalProfile,
  refusalMessage,
  useProfile,
  useSaveProfile,
} from "@/lib/portal";

import { PortalButton, PortalCard, PortalHeading, QueryState } from "./shared";

/** Profile and consent: contact details the patient can correct, and what we may do with them. */
export function PortalProfileScreen() {
  const profile = useProfile();
  return (
    <>
      <PortalHeading title="Profile" lead="Your details and what you agree to." />
      <QueryState
        query={profile}
        what="profile"
        empty="Your profile is not available."
        isEmpty={() => false}
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <Details profile={data} />
            <Consents profile={data} />
          </div>
        )}
      </QueryState>
    </>
  );
}

function Details({ profile }: { profile: PortalProfile }) {
  const toast = useToast();
  const save = useSaveProfile();
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.email);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      await save.mutateAsync({ phone: phone.trim(), email: email.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Details saved", tone: "success" });
  }

  return (
    <PortalCard title="Your details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="text-body text-ink-600">Name</dt>
        <dd className="text-body text-ink-900 font-semibold">
          {profile.first_name} {profile.last_name}
        </dd>
        <dt className="text-body text-ink-600">Date of birth</dt>
        <dd className="text-body text-ink-900">{formatDay(profile.date_of_birth)}</dd>
        <dt className="text-body text-ink-600">Patient number</dt>
        <dd className="text-body text-ink-900 font-mono">{profile.mrn}</dd>
      </dl>
      <p className="text-small text-ink-600">
        To change your name or date of birth, ask at the front desk.
      </p>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label="Phone number"
          type="tel"
          inputMode="tel"
          hint="With the country code, such as +2348031234567."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <PortalButton type="submit" loading={save.isPending}>
            Save my details
          </PortalButton>
        </div>
      </form>
    </PortalCard>
  );
}

function Consents({ profile }: { profile: PortalProfile }) {
  const toast = useToast();
  const save = useSaveProfile();
  const [problem, setProblem] = useState<string | null>(null);

  async function change(key: ConsentKey, value: boolean) {
    setProblem(null);
    try {
      await save.mutateAsync({ consents: { ...profile.consents, [key]: value } });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Choice saved", tone: "success" });
  }

  return (
    <PortalCard title="Your choices">
      {problem && <Banner tone="danger" live title={problem} />}
      <ul className="flex flex-col gap-4">
        {CONSENTS.map((c) => {
          const id = `consent-${c.key}`;
          return (
            <li key={c.key} className="flex items-start gap-3">
              <input
                id={id}
                type="checkbox"
                checked={profile.consents[c.key]}
                disabled={save.isPending}
                onChange={(e) => void change(c.key, e.target.checked)}
                aria-describedby={`${id}-why`}
                className={cx("mt-1 size-6 shrink-0 accent-blue-600", FOCUS_RING)}
              />
              <div className="flex flex-col gap-1">
                <label htmlFor={id} className="text-body text-ink-900 min-h-6 font-semibold">
                  {c.label}
                </label>
                <p id={`${id}-why`} className="text-small text-ink-600">
                  {c.explain}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </PortalCard>
  );
}
