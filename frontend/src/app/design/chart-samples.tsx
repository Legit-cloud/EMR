"use client";

import { useState } from "react";

import { AreaLineChart } from "@/components/charts/area-line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { PairedBarChart } from "@/components/charts/paired-bar-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { Card } from "@/components/ui/card";
import { DeltaChip, KpiBlock } from "@/components/ui/kpi";
import { MiniTiles } from "@/components/ui/mini-tile";
import { SegmentedStatBar } from "@/components/ui/progress";
import { RangeSelect } from "@/components/ui/select";
import { STOCK_SERIES } from "@/lib/chart-colours";
import { formatMoney } from "@/lib/format";

// Synthetic sample data only. Money in kobo.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CASHFLOW = [42, 51, 47, 63, 58, 72, 66, 81, 77, 90, 86, 98].map((k, i) => ({
  label: MONTHS[i],
  value: k * 100_000,
}));
const LAST_MONTH = CASHFLOW.slice(-4).map((p, i) => ({
  label: `Week ${i + 1}`,
  value: p.value / 4,
}));
const INCOME_EXPENSE = [
  [62, 38],
  [70, 44],
  [58, 49],
  [81, 40],
  [76, 52],
  [88, 47],
].map(([income, expense], i) => ({
  label: MONTHS[i + 6],
  income: income * 100_000,
  expense: expense * 100_000,
}));
const EXPENSES = [
  { label: "Salaries", value: 4_200_000 },
  { label: "Drugs and supplies", value: 2_600_000 },
  { label: "Utilities", value: 1_100_000 },
  { label: "Equipment", value: 800_000 },
  { label: "Rent", value: 700_000 },
  { label: "Other", value: 300_000 },
];
const HEART_RATE = [78, 82, 76, 74, 71, 73, 70].map((value, i) => ({
  label: `Day ${i + 1}`,
  value,
}));
const SYSTOLIC = [148, 144, 141, 139, 136, 132, 130].map((value, i) => ({
  label: `Day ${i + 1}`,
  value,
}));

const naira = (minor: number) => formatMoney(minor, "NGN");
/** "₦98k": whole thousands of naira for the y axis. */
const nairaAxis = (minor: number) => `₦${Math.round(minor / 100_000)}k`;

const RANGES = [
  { value: "12m", label: "Last 12 months" },
  { value: "month", label: "This month" },
];

function Cashflow() {
  const [range, setRange] = useState("12m");
  const data = range === "12m" ? CASHFLOW : LAST_MONTH;
  const total = data.reduce((sum, p) => sum + p.value, 0);
  return (
    <Card title="Cashflow" className="lg:col-span-8">
      <div className="flex items-center gap-3">
        <span className="text-kpi text-ink-900 tnum">{naira(total)}</span>
        <DeltaChip value={12.5} />
      </div>
      <AreaLineChart
        label="Cashflow"
        data={data}
        formatValue={naira}
        formatAxis={nairaAxis}
        rangeSelector={
          <RangeSelect
            label="Cashflow period"
            value={range}
            onValueChange={setRange}
            options={RANGES}
          />
        }
      />
    </Card>
  );
}

/** The charts from DESIGN.md Sections 2.3 and 7, laid out as on the dashboard. */
export function ChartSamples() {
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Cashflow />
      <Card title="Expenses" className="lg:col-span-4">
        <DonutChart label="Expenses" data={EXPENSES} formatValue={naira} />
        <MiniTiles
          items={[
            { label: "Top expense", value: naira(4_200_000), tone: "purple" },
            { label: "Largest rise", value: naira(600_000), tone: "pink" },
          ]}
        />
      </Card>
      <Card title="Income and expense" className="lg:col-span-8">
        <PairedBarChart
          label="Income and expense"
          data={INCOME_EXPENSE}
          formatValue={naira}
          formatAxis={nairaAxis}
        />
      </Card>
      <Card title="Sparklines and stock" className="lg:col-span-4">
        <div className="flex items-end justify-between gap-3">
          <KpiBlock label="Heart rate" value="70 bpm" delta={-10} goodWhen="down" />
          <Sparkline label="Heart rate, last 7 days" data={HEART_RATE} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <KpiBlock label="Systolic BP" value="130 mmHg" delta={-12} goodWhen="down" />
          <Sparkline label="Systolic blood pressure, last 7 days" data={SYSTOLIC} />
        </div>
        <SegmentedStatBar
          label="Stock availability"
          segments={[
            { label: "In stock", value: 20, fill: STOCK_SERIES.available },
            { label: "Low stock", value: 4, fill: STOCK_SERIES.low },
            { label: "Out of stock", value: 8, fill: STOCK_SERIES.out },
          ]}
        />
      </Card>
      <Card title="Loading" className="lg:col-span-6">
        <AreaLineChart label="Cashflow" data={[]} loading height={160} />
        <Sparkline label="Heart rate" data={[]} loading />
        <SegmentedStatBar label="Stock availability" segments={[]} loading />
      </Card>
      <Card title="Empty" className="lg:col-span-6">
        <PairedBarChart label="Income and expense" data={[]} height={160} />
        <SegmentedStatBar label="Stock availability" segments={[]} emptyText="No stock yet." />
      </Card>
    </div>
  );
}
