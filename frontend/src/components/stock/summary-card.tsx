import { Coins, Package } from "@phosphor-icons/react";

import { Card } from "@/components/ui/card";
import { KpiBlock } from "@/components/ui/kpi";
import { SegmentedStatBar } from "@/components/ui/progress";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { STOCK_SERIES } from "@/lib/chart-colours";
import { formatMoney } from "@/lib/money";
import type { StockSummary } from "@/lib/stock";

type Props = { summary: StockSummary | undefined; error: boolean };

/** The header: total asset value, product count, and drugs in stock, low and out. */
export function SummaryCard({ summary, error }: Props) {
  if (error && !summary) {
    return (
      <Card title="Overview">
        <p role="alert" className="text-body text-ink-600">
          The stock totals could not be loaded.
        </p>
      </Card>
    );
  }
  if (!summary) {
    return (
      <Card title="Overview">
        <Loading label="Loading stock totals">
          <div className="grid gap-5 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </Loading>
      </Card>
    );
  }
  return (
    <Card title="Overview">
      <div className="grid gap-5 sm:grid-cols-2">
        <KpiBlock
          label="Total asset value"
          value={formatMoney(summary.value_minor, summary.currency)}
          icon={{ icon: Coins, tone: "amber" }}
          caption="Units on hand at selling price"
        />
        <KpiBlock
          label="Products"
          value={String(summary.products)}
          icon={{ icon: Package, tone: "blue" }}
          caption="On the formulary"
        />
      </div>
      <SegmentedStatBar
        label="Drugs by stock level"
        emptyText="No drugs on the formulary yet."
        segments={[
          { label: "In stock", value: summary.in_stock, fill: STOCK_SERIES.available },
          { label: "Low stock", value: summary.low, fill: STOCK_SERIES.low },
          { label: "Out of stock", value: summary.out, fill: STOCK_SERIES.out },
        ]}
      />
    </Card>
  );
}
