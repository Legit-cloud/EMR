"use client";

import { CalendarBlank, Flask, Receipt } from "@phosphor-icons/react";
import Link from "next/link";

import { FOCUS_RING } from "@/components/ui/focus";
import { IconTile } from "@/components/ui/icon-tile";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { useHome } from "@/lib/portal";

import { PortalCard, PortalHeading, QueryState } from "./shared";

const CTA = cx(
  "rounded-control inline-flex min-h-11 items-center font-semibold text-blue-600 underline",
  FOCUS_RING,
);

/** Home: the next appointment, new results and what is owed, each with one way on. */
export function PortalHome() {
  const home = useHome();
  return (
    <QueryState query={home} what="home page" empty="Nothing to show yet." isEmpty={() => false}>
      {(data) => (
        <>
          <PortalHeading
            title={`Hello, ${data.first_name}`}
            lead="Here is what needs your attention."
          />
          <div className="flex flex-col gap-4">
            <PortalCard title="Your next appointment">
              <div className="flex items-start gap-3">
                <IconTile icon={CalendarBlank} tone="blue" size={44} />
                {data.next_appointment ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-body text-ink-900 font-bold">
                      {formatDateTime(data.next_appointment.start_at)}
                    </p>
                    <p className="text-body text-ink-600">
                      {data.next_appointment.doctor_name}, {data.next_appointment.specialty}
                    </p>
                    <p className="text-body text-ink-600">{data.next_appointment.location}</p>
                  </div>
                ) : (
                  <p className="text-body text-ink-600">You have no visit booked.</p>
                )}
              </div>
              <Link href="/portal/appointments" className={CTA}>
                {data.next_appointment ? "See or change your visits" : "Book a visit"}
              </Link>
            </PortalCard>

            <PortalCard title="New results">
              <div className="flex items-start gap-3">
                <IconTile icon={Flask} tone="purple" size={44} />
                <p className="text-body text-ink-900">
                  {data.new_results === 0
                    ? "No new results."
                    : data.new_results === 1
                      ? "You have 1 new result to read."
                      : `You have ${data.new_results} new results to read.`}
                </p>
              </div>
              <Link href="/portal/results" className={CTA}>
                {data.new_results > 0 ? "Read your results" : "See past results"}
              </Link>
            </PortalCard>

            <PortalCard title="Your balance">
              <div className="flex items-start gap-3">
                <IconTile
                  icon={Receipt}
                  tone={data.balance_minor > 0 ? "amber" : "green"}
                  size={44}
                />
                <div className="flex flex-col gap-1">
                  <p className="text-card-title text-ink-900 tnum">
                    {formatMoney(data.balance_minor, data.currency)}
                  </p>
                  <p className="text-body text-ink-600">
                    {data.balance_minor > 0
                      ? "Still to pay across your bills."
                      : "You owe nothing."}
                  </p>
                </div>
              </div>
              {data.balance_minor > 0 && (
                <Link href="/portal/invoices" className={CTA}>
                  See your bills and pay
                </Link>
              )}
            </PortalCard>
          </div>
        </>
      )}
    </QueryState>
  );
}
