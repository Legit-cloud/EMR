"use client";

import { StatusPill } from "@/components/ui/status-pill";
import { formatDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { useInvoices } from "@/lib/portal";
import { PAYMENT_STATUS } from "@/lib/status-map";

import { PortalCard, PortalHeading, QueryState } from "./shared";

/**
 * Bills: what each was for, what is paid and what is owed. Paying online is not built (no payment
 * gateway has been chosen), so the page says how to pay at the hospital instead of offering a
 * button that could only pretend.
 */
export function PortalInvoices() {
  const invoices = useInvoices();
  return (
    <>
      <PortalHeading title="Invoices" lead="Your bills and what you owe." />
      <QueryState query={invoices} what="invoices" empty="You have no bills.">
        {(rows) => (
          <div className="flex flex-col gap-4">
            {rows.some((i) => i.due_minor > 0) && (
              <PortalCard title="How to pay">
                <p className="text-body text-ink-900">
                  Pay at the cashier, or by bank transfer, and quote the bill number shown on the
                  bill. Paying online is not available yet. Your balance here updates once the
                  hospital has recorded your payment.
                </p>
              </PortalCard>
            )}
            <ul className="flex flex-col gap-4">
              {rows.map((i) => (
                <li key={i.id}>
                  <PortalCard
                    title={`Bill ${i.reference}`}
                    action={<StatusPill status={PAYMENT_STATUS[i.status]} />}
                  >
                    <p className="text-small text-ink-600">Issued {formatDay(i.created_at)}</p>
                    <ul aria-label={`What bill ${i.reference} was for`} className="flex flex-col">
                      {i.lines.map((line, n) => (
                        <li
                          key={n}
                          className="border-line flex justify-between gap-3 border-t py-2 first:border-t-0"
                        >
                          <span className="text-body text-ink-900">{line.description}</span>
                          <span className="text-body tnum">
                            {formatMoney(line.amount_minor, i.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <dl className="border-line grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3">
                      <dt className="text-body text-ink-600">Total</dt>
                      <dd className="text-body tnum text-right">
                        {formatMoney(i.total_minor, i.currency)}
                      </dd>
                      <dt className="text-body text-ink-600">You have paid</dt>
                      <dd className="text-body tnum text-right">
                        {formatMoney(i.paid_minor, i.currency)}
                      </dd>
                      <dt className="text-body text-ink-900 font-bold">Still to pay</dt>
                      <dd
                        aria-label={`Still to pay on ${i.reference}`}
                        className="text-card-title text-ink-900 tnum text-right"
                      >
                        {formatMoney(i.due_minor, i.currency)}
                      </dd>
                    </dl>
                  </PortalCard>
                </li>
              ))}
            </ul>
          </div>
        )}
      </QueryState>
    </>
  );
}
