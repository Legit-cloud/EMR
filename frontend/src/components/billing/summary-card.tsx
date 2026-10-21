import { Coins, Hourglass, Receipt } from "@phosphor-icons/react";

import { Card } from "@/components/ui/card";
import { KpiBlock } from "@/components/ui/kpi";
import { SegmentedStatBar } from "@/components/ui/progress";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import type { Schemas } from "@/lib/api";
import { PAYMENT_SERIES } from "@/lib/chart-colours";
import { formatMoney } from "@/lib/money";

type Props = {
  summary: Schemas["InvoiceSummary"] | undefined;
  error: boolean;
};

/** The totals header: money billed, collected and still due, and invoices by payment status. */
export function SummaryCard({ summary, error }: Props) {
  if (error && !summary) {
    return (
      <Card title="Overview">
        <p role="alert" className="text-body text-ink-600">
          The billing totals could not be loaded.
        </p>
      </Card>
    );
  }
  if (!summary) {
    return (
      <Card title="Overview">
        <Loading label="Loading billing totals">
          <div className="grid gap-5 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </Loading>
      </Card>
    );
  }
  const money = (minor: number) => formatMoney(minor, summary.currency);
  return (
    <Card title="Overview">
      <div className="grid gap-5 sm:grid-cols-3">
        <KpiBlock
          label="Billed"
          value={money(summary.billed_minor)}
          icon={{ icon: Receipt, tone: "blue" }}
        />
        <KpiBlock
          label="Collected"
          value={money(summary.collected_minor)}
          icon={{ icon: Coins, tone: "green" }}
        />
        <KpiBlock
          label="Still due"
          value={money(summary.outstanding_minor)}
          icon={{ icon: Hourglass, tone: "amber" }}
        />
      </div>
      <SegmentedStatBar
        label="Invoices by payment status"
        emptyText="No invoices yet."
        segments={[
          { label: "Paid", value: summary.paid_count, fill: PAYMENT_SERIES.paid },
          {
            label: "Partly paid",
            value: summary.partially_paid_count,
            fill: PAYMENT_SERIES.partial,
          },
          { label: "Unpaid", value: summary.unpaid_count, fill: PAYMENT_SERIES.unpaid },
        ]}
      />
    </Card>
  );
}
