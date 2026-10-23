"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { FOCUS_RING } from "@/components/ui/focus";
import { cx } from "@/lib/cx";
import { type PrivacyNotice, usePrivacyNotice } from "@/lib/portal";

import { PortalCard, PortalHeading, QueryState } from "./shared";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PortalCard title={title}>
      <div className="text-body text-ink-900 flex flex-col gap-2">{children}</div>
    </PortalCard>
  );
}

/**
 * How the hospital uses a patient's information, in plain words. The hospital's name, the contact
 * address, the retention period and the days allowed to answer come from the server's settings; the
 * wording is versioned with the server (PRIVACY_NOTICE_VERSION). Legal review of this text is a
 * condition of launch (docs/signoff/data-protection.md).
 */
export function PortalPrivacy() {
  const notice = usePrivacyNotice();
  return (
    <>
      <PortalHeading
        title="How we use your information"
        lead="What we hold, why, and your rights."
      />
      <QueryState query={notice} what="privacy notice" empty="" isEmpty={() => false}>
        {(n) => <Notice notice={n} />}
      </QueryState>
    </>
  );
}

function Notice({ notice }: { notice: PrivacyNotice }) {
  const who = notice.controller_name || "The hospital";
  const link = cx(
    "rounded-control inline-flex min-h-11 items-center font-semibold text-blue-600 underline",
    FOCUS_RING,
  );
  return (
    <div className="flex flex-col gap-4">
      <Section title="Who is responsible">
        <p>
          {who} looks after your information and decides how it is used.{" "}
          {notice.contact_email ? (
            <>
              To ask a question about it, write to{" "}
              <a className={link} href={`mailto:${notice.contact_email}`}>
                {notice.contact_email}
              </a>
              .
            </>
          ) : (
            "Ask at the front desk if you have a question about it."
          )}
        </p>
      </Section>

      <Section title="What we hold">
        <ul className="list-disc pl-5">
          <li>Who you are and how to reach you: name, date of birth, phone, email, address.</li>
          <li>
            Your health record: your visits, tests, diagnoses, medicines, and the notes your care
            team writes.
          </li>
          <li>Your bills and payments. We do not see or keep your card details.</li>
          <li>
            Your use of this portal: when you sign in, what you view or book, and the emails we send
            you.
          </li>
        </ul>
      </Section>

      <Section title="Why we use it">
        <ul className="list-disc pl-5">
          <li>
            To look after you. This is the main reason, and it does not depend on a consent form.
          </li>
          <li>To bill you, and to take payment.</li>
          <li>
            To meet the law, for example keeping medical records and reporting where required.
          </li>
          <li>To keep your account and your record safe.</li>
          <li>To remind you of appointments and bills, if you want those reminders.</li>
        </ul>
        <p>We do not sell your information and we do not use it for advertising.</p>
      </Section>

      <Section title="Who sees it">
        <p>
          The doctors, nurses and staff who are caring for you see what they need to. Staff in
          billing or the pharmacy see only what their work needs. Every time someone opens your
          record it is written down.
        </p>
        <p>
          Some companies help us: Paystack takes card and bank payments for us, and an email service
          delivers our messages. If you have an insurer, we share what your claim needs with them.
          We share your information with anyone else only when the law requires it, or you ask us
          to.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep medical records for at least {notice.retention_years} years after your last visit,
          and longer for children and where the law says so. Bills and payment records are kept as
          long as accounting rules require.
        </p>
      </Section>

      <Section title="Your rights">
        <p>You can ask us to:</p>
        <ul className="list-disc pl-5">
          <li>give you a copy of your information,</li>
          <li>correct anything that is wrong,</li>
          <li>
            delete your information, though we must keep medical records for the time the law
            requires,
          </li>
          <li>limit how we use it, or stop a use you object to,</li>
          <li>send it to another provider.</li>
        </ul>
        <p>
          We will answer within {notice.response_days} days. If we cannot do what you ask, we will
          tell you why.
        </p>
        <p>
          <Link href="/portal/rights" className={link}>
            Make a request
          </Link>
        </p>
        <p>
          If you are not happy with our answer, you can complain to the Nigeria Data Protection
          Commission.
        </p>
      </Section>

      <p className="text-small text-ink-500">Notice version {notice.version}.</p>
    </div>
  );
}
