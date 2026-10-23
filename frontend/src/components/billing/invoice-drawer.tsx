"use client";

import { Bell, CreditCard, Receipt } from "@phosphor-icons/react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Drawer, type DrawerSection } from "@/components/ui/drawer";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  canTakePayment,
  type Invoice,
  type InvoiceLine,
  METHOD_LABEL,
  percentText,
  refusalMessage,
  reminderBlock,
  useInsurers,
  useInvoice,
  useSendReminder,
} from "@/lib/billing";
import { cx } from "@/lib/cx";
import { formatDateTime, formatDay } from "@/lib/format";
import { formatMoney, sumMinor } from "@/lib/money";
import { ESTATE_REVIEW, LINE_SOURCE, LINE_STATUS, PAYMENT_STATUS } from "@/lib/status-map";

import { ChargeDialog } from "./charge-dialog";
import { CoverageDialog } from "./coverage-dialog";
import { PaymentDialog } from "./payment-dialog";

type Props = {
  /** The invoice to show, or null when the drawer is closed. */
  invoiceId: string | null;
  onClose: () => void;
  /** Whether the viewer's role takes payments and edits bills; the API still decides. */
  canCollect: boolean;
};

/**
 * The invoice drawer (docs/DESIGN.md Section 8): the patient, each charge with where it came
 * from, who pays what, the totals with what is still due, and the actions for taking money.
 * Sections on the left switch between the bill and its payments.
 */
export function InvoiceDrawer({ invoiceId, onClose, canCollect }: Props) {
  const invoice = useInvoice(invoiceId);
  const [section, setSection] = useState("bill");
  const open = invoiceId !== null;

  const denied = invoice.error instanceof ApiRequestError && invoice.error.status === 403;
  const missing = invoice.error instanceof ApiRequestError && invoice.error.status === 404;
  const data = invoice.data;

  const message = (text: string) => <p className="text-body text-ink-600">{text}</p>;
  const placeholder = denied ? (
    message("Invoices are not available to your role.")
  ) : missing ? (
    message("This invoice could not be found.")
  ) : invoice.isError ? (
    message("This invoice could not be loaded. Close the drawer and try again.")
  ) : (
    <Loading label="Loading invoice">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </Loading>
  );

  const sections: DrawerSection[] = [
    {
      value: "bill",
      label: "Bill",
      icon: Receipt,
      content: data ? <BillSection invoice={data} /> : placeholder,
    },
    {
      value: "payments",
      label: "Payments",
      icon: CreditCard,
      content: data ? <PaymentsSection invoice={data} /> : placeholder,
    },
  ];

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={data ? `Invoice ${data.reference}` : "Invoice"}
      heading={
        data ? (
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-base font-bold">
              Invoice <span className="tnum">{data.reference}</span>
            </span>
            <span data-testid="payment-status">
              <StatusPill status={PAYMENT_STATUS[data.payment_status]} />
            </span>
            {data.estate_review && <StatusPill status={ESTATE_REVIEW} />}
          </span>
        ) : undefined
      }
      sections={sections}
      section={section}
      onSectionChange={setSection}
      footer={data ? <DrawerFooter invoice={data} canCollect={canCollect} /> : undefined}
    />
  );
}

// -- the bill ---------------------------------------------------------------------------------

function BillSection({ invoice }: { invoice: Invoice }) {
  const insurers = useInsurers();
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const paid = sumMinor([invoice.insurer_paid_minor, invoice.patient_paid_minor]);
  const insurerName =
    insurers.data?.find((i) => i.id === invoice.insurer)?.name ??
    (invoice.insurer ? "Insurer" : null);

  return (
    <div className="flex flex-col gap-5">
      {invoice.estate_review && (
        <Banner tone="danger" title="Held for estate settlement review">
          The patient has died with a balance outstanding. Do not send reminders or collect from the
          family until the review is done.
        </Banner>
      )}

      <section
        aria-label="Patient"
        className="rounded-card border-line flex items-center gap-3 border p-4"
      >
        <Avatar name={invoice.patient_name || "Patient"} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-card-title text-ink-900 truncate">{invoice.patient_name || "—"}</p>
          <p className="text-small text-ink-600 font-mono">{invoice.patient_mrn}</p>
        </div>
        <p className="text-small text-ink-500 tnum text-right">
          Opened {formatDay(invoice.created_at)}
        </p>
      </section>

      <section aria-label="Charges" className="flex flex-col gap-2">
        <h3 className="text-card-title text-ink-900">Charges</h3>
        <ChargesTable lines={invoice.lines} currency={invoice.currency} />
      </section>

      <section aria-label="Who pays" className="flex flex-col gap-3">
        <h3 className="text-card-title text-ink-900">Who pays</h3>
        <dl className="rounded-card bg-surface-muted grid gap-3 p-4 text-body">
          {insurerName && (
            <Share
              label={`${insurerName} · ${percentText(invoice.insurer_coverage_bp)}`}
              share={money(invoice.insurer_due_minor)}
              received={money(invoice.insurer_paid_minor)}
              testId="insurer-due"
            />
          )}
          <Share
            label="Patient"
            share={money(invoice.patient_due_minor)}
            received={money(invoice.patient_paid_minor)}
            testId="patient-due"
          />
        </dl>
      </section>

      <section
        aria-label="Totals"
        className="rounded-card border-line flex flex-col gap-3 border p-4"
      >
        <Row label="Total" value={money(invoice.total_minor)} testId="total" />
        <Row label="Paid so far" value={money(paid)} testId="paid" />
        <div className="border-line flex items-baseline justify-between gap-3 border-t pt-3">
          <span className="text-label-caps text-ink-500 uppercase">Still due</span>
          <span data-testid="net-due" className="text-kpi text-ink-900 tnum">
            {money(invoice.net_due_minor)}
          </span>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-body text-ink-600">{label}</span>
      <span data-testid={testId} className="text-body text-ink-900 tnum font-semibold">
        {value}
      </span>
    </div>
  );
}

function Share({
  label,
  share,
  received,
  testId,
}: {
  label: string;
  share: string;
  received: string;
  testId: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <dt className="text-ink-900 font-semibold">{label}</dt>
      <dd className="text-ink-600 tnum text-right">
        pays{" "}
        <span data-testid={testId} className="text-ink-900 font-semibold">
          {share}
        </span>
        <span className="text-small"> · received {received}</span>
      </dd>
    </div>
  );
}

function ChargesTable({ lines, currency }: { lines: InvoiceLine[]; currency: string }) {
  if (lines.length === 0) {
    return <p className="text-body text-ink-600">No charges on this invoice yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-body w-full text-left">
        <caption className="sr-only">Charges</caption>
        <thead className="bg-surface-muted text-label-caps text-ink-500 h-10 uppercase">
          <tr>
            <th scope="col" className="px-3">
              Item
            </th>
            <th scope="col" className="px-3 text-right">
              Qty
            </th>
            <th scope="col" className="px-3 text-right">
              Unit price
            </th>
            <th scope="col" className="px-3 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const void_ = line.status === "void";
            return (
              <tr key={line.id} className="border-line border-t align-top">
                <td className="px-3 py-3">
                  <span
                    className={cx("flex flex-col gap-1.5", void_ && "text-ink-500 line-through")}
                  >
                    <span className="text-ink-900 font-semibold">{line.description}</span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <StatusPill status={LINE_SOURCE[line.revenue_category]} />
                    {line.status !== "final" && <StatusPill status={LINE_STATUS[line.status]} />}
                  </span>
                </td>
                <td className="tnum px-3 py-3 text-right">{line.quantity}</td>
                <td className="tnum px-3 py-3 text-right whitespace-nowrap">
                  {formatMoney(line.unit_price_minor, currency)}
                </td>
                <td
                  className={cx(
                    "tnum px-3 py-3 text-right font-semibold whitespace-nowrap",
                    void_ && "text-ink-500 line-through",
                  )}
                >
                  {formatMoney(line.amount_minor, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -- payments ---------------------------------------------------------------------------------

function PaymentsSection({ invoice }: { invoice: Invoice }) {
  if (invoice.payments.length === 0) {
    return <p className="text-body text-ink-600">No payments have been recorded yet.</p>;
  }
  const newestFirst = [...invoice.payments].sort((a, b) =>
    b.received_at.localeCompare(a.received_at),
  );
  return (
    <section aria-label="Payments" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {newestFirst.map((payment) => (
          <li
            key={payment.id}
            className="rounded-card border-line flex flex-wrap items-center gap-x-4 gap-y-1 border p-4"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body text-ink-900 font-semibold">
                {METHOD_LABEL[payment.method]}
                <span className="text-ink-600 font-normal"> · from the {payment.payer}</span>
              </span>
              <span className="text-small text-ink-500 tnum">
                {formatDateTime(payment.received_at)}
                {payment.reference ? ` · ref ${payment.reference}` : ""}
              </span>
            </span>
            <span className="text-body text-ink-900 tnum font-semibold">
              {formatMoney(payment.amount_minor, payment.currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// -- actions ----------------------------------------------------------------------------------

function DrawerFooter({ invoice, canCollect }: { invoice: Invoice; canCollect: boolean }) {
  const toast = useToast();
  const remind = useSendReminder();
  const [dialog, setDialog] = useState<"pay" | "coverage" | "charge" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const blocked = reminderBlock(invoice);
  const unsettled = invoice.payment_status !== "paid";
  const close = (open: boolean) => !open && setDialog(null);

  async function sendReminder() {
    setProblem(null);
    try {
      await remind.mutateAsync(invoice.id);
      toast({
        title: "Reminder sent",
        description: "Sent by email",
        tone: "success",
      });
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  if (!canCollect) {
    return (
      <p className="text-small text-ink-600">Your role can view this invoice but not change it.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {problem && <Banner tone="danger" live title={problem} />}
      <div className="flex flex-wrap items-center gap-3">
        {canTakePayment(invoice) && <Button onClick={() => setDialog("pay")}>Take payment</Button>}
        <Button
          variant="outline"
          icon={Bell}
          disabled={blocked !== null}
          loading={remind.isPending}
          onClick={sendReminder}
        >
          Send Reminder
        </Button>
        {unsettled && (
          <>
            <Button variant="ghost" onClick={() => setDialog("coverage")}>
              Insurer coverage
            </Button>
            <Button variant="ghost" onClick={() => setDialog("charge")}>
              Add charge
            </Button>
          </>
        )}
      </div>
      {blocked ? (
        <p className="text-small text-ink-600">{blocked}</p>
      ) : (
        invoice.last_reminder_at && (
          <p className="text-small text-ink-600">
            Last reminder sent {formatDateTime(invoice.last_reminder_at)}.
          </p>
        )
      )}
      <PaymentDialog invoice={invoice} open={dialog === "pay"} onOpenChange={close} />
      <CoverageDialog invoice={invoice} open={dialog === "coverage"} onOpenChange={close} />
      <ChargeDialog invoice={invoice} open={dialog === "charge"} onOpenChange={close} />
    </div>
  );
}
