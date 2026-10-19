"use client";

import { format, parseISO } from "date-fns";

import { AreaLineChart } from "@/components/charts/area-line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { PairedBarChart } from "@/components/charts/paired-bar-chart";
import { Card } from "@/components/ui/card";
import { DeltaChip } from "@/components/ui/kpi";
import { MiniTiles } from "@/components/ui/mini-tile";
import { RangeSelect } from "@/components/ui/select";
import type { Schemas } from "@/lib/api";
import { compactMoney, formatMoney } from "@/lib/format";

/** The periods the API offers (apps/reports RANGES). */
export type DashboardRange = "12m" | "30d";
type Finance = Schemas["Finance"];

export const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "12m", label: "Last 12 months" },
  { value: "30d", label: "Last 30 days" },
];

/** "Jan" for monthly periods, "14 Oct" for daily ones. */
export function periodLabel(start: string, range: DashboardRange): string {
  return format(parseISO(start), range === "12m" ? "MMM" : "d MMM");
}

/** Percent change against the previous period; undefined when there is nothing to compare. */
export function percentChange(current: number, previous: number): number | undefined {
  return previous > 0 ? ((current - previous) / previous) * 100 : undefined;
}

type RangeProps = { range: DashboardRange; onRangeChange: (range: DashboardRange) => void };

/** Payments received over the range, with the change against the period before. */
export function CashflowCard({ finance, range, onRangeChange }: { finance: Finance } & RangeProps) {
  const money = (minor: number) => formatMoney(minor, finance.currency);
  const delta = percentChange(finance.collected_minor, finance.previous_collected_minor);
  return (
    <Card title="Cashflow" className="lg:col-span-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-kpi text-ink-900 tnum">{money(finance.collected_minor)}</span>
        {delta !== undefined && <DeltaChip value={delta} />}
        <span className="text-small text-ink-500">collected, against the period before</span>
      </div>
      <AreaLineChart
        label="Cashflow"
        data={finance.periods.map((p) => ({
          label: periodLabel(p.start, range),
          value: p.collected_minor,
        }))}
        formatValue={money}
        formatAxis={(minor) => compactMoney(minor, finance.currency)}
        emptyText="No payments received in this period."
        rangeSelector={
          <RangeSelect
            label="Dashboard period"
            value={range}
            onValueChange={(value) => onRangeChange(value as DashboardRange)}
            options={RANGE_OPTIONS}
          />
        }
      />
    </Card>
  );
}

/** What was billed, by kind of service. Stands in for the reference's expenses card until
 * expenses are recorded (accounting arrives in Release 3). */
export function RevenueMixCard({ finance }: { finance: Finance }) {
  const money = (minor: number) => formatMoney(minor, finance.currency);
  const billed = finance.periods.reduce((sum, p) => sum + p.billed_minor, 0);
  const outstanding = Math.max(0, billed - finance.collected_minor);
  const top = finance.revenue_mix[0];
  return (
    <Card title="Revenue by service" className="lg:col-span-4">
      <DonutChart
        label="Revenue by service"
        totalLabel="Billed"
        data={finance.revenue_mix.map((r) => ({ label: r.label, value: r.amount_minor }))}
        formatValue={money}
        emptyText="Nothing billed in this period."
      />
      <MiniTiles
        items={[
          {
            label: top ? `Top: ${top.label}` : "Top service",
            value: top ? money(top.amount_minor) : "—",
            tone: "purple",
          },
          { label: "Not yet collected", value: money(outstanding), tone: "amber" },
        ]}
      />
    </Card>
  );
}

/** Billed against collected per period: the gap is money still owed. */
export function BilledCollectedCard({
  finance,
  range,
}: {
  finance: Finance;
  range: DashboardRange;
}) {
  const money = (minor: number) => formatMoney(minor, finance.currency);
  const periods = range === "12m" ? finance.periods.slice(-6) : finance.periods.slice(-7);
  return (
    <Card title="Billed and collected" className="lg:col-span-8">
      <PairedBarChart
        label="Billed and collected"
        names={{ income: "Billed", expense: "Collected" }}
        data={periods.map((p) => ({
          label: periodLabel(p.start, range),
          income: p.billed_minor,
          expense: p.collected_minor,
        }))}
        formatValue={money}
        formatAxis={(minor) => compactMoney(minor, finance.currency)}
        emptyText="Nothing billed or collected in this period."
      />
      <p className="text-small text-ink-500">
        {range === "12m" ? "Last 6 months." : "Last 7 days."}
      </p>
    </Card>
  );
}
