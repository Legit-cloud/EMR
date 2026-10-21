"use client";

import { Coins } from "@phosphor-icons/react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { FOCUS_RING } from "@/components/ui/focus";
import { KpiBlock } from "@/components/ui/kpi";
import { SegmentedStatBar } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/status-pill";
import type { Schemas } from "@/lib/api";
import { percentages, STOCK_SERIES } from "@/lib/chart-colours";
import { cx } from "@/lib/cx";
import { formatMoney } from "@/lib/format";
import { STOCK_LEVEL } from "@/lib/status-map";
import { stockHref } from "@/lib/stock";

const LINK = cx("text-small rounded-tag font-semibold text-blue-600 hover:underline", FOCUS_RING);

/** Patients seen in the range: first visits against patients who came back. */
export function PatientsCard({ mix }: { mix: Schemas["PatientMix"] }) {
  const [newShare, returningShare] = percentages([mix.new, mix.returning]);
  const total = mix.new + mix.returning;
  return (
    <Card title="Patients seen">
      <div className="grid grid-cols-2 gap-4">
        <KpiBlock label="New" value={String(mix.new)} caption={`${newShare}% of visits`} />
        <KpiBlock
          label="Returning"
          value={String(mix.returning)}
          caption={`${returningShare}% of visits`}
        />
      </div>
      <SegmentedStatBar
        label={`${total} patients seen: ${mix.new} new, ${mix.returning} returning`}
        segments={[
          { label: "New", value: mix.new, fill: "bg-chart-sky" },
          { label: "Returning", value: mix.returning, fill: "bg-purple" },
        ]}
        emptyText="No visits attended in this period."
      />
    </Card>
  );
}

/** The services billed most often in the range. */
export function PopularServicesCard({ services }: { services: Schemas["ServiceCount"][] }) {
  return (
    <Card title="Popular services">
      {services.length === 0 ? (
        <p className="text-small text-ink-600">No services billed in this period.</p>
      ) : (
        <ol className="flex flex-col">
          {services.map((service, i) => (
            <li
              key={service.name}
              className="border-line text-body flex items-center gap-3 border-t py-2.5 first:border-t-0"
            >
              <span className="text-small text-ink-500 tnum w-4">{i + 1}</span>
              <span className="text-ink-900 min-w-0 flex-1 truncate">{service.name}</span>
              <span className="text-ink-600 tnum shrink-0">
                {service.count} {service.count === 1 ? "time" : "times"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Formulary stock: value, how many drugs are in stock, low or out, and which to reorder. */
export function StockCard({ stock, className }: { stock: Schemas["Stock"]; className?: string }) {
  return (
    <Card
      title="Stock availability"
      className={className}
      action={
        <Link href="/pharmacy/stock" className={LINK}>
          View all
        </Link>
      }
    >
      <KpiBlock
        label="Stock value"
        value={formatMoney(stock.value_minor, stock.currency)}
        icon={{ icon: Coins, tone: "amber" }}
        caption={`${stock.products} products on the formulary, at selling price`}
      />
      <SegmentedStatBar
        label="Stock availability"
        segments={[
          { label: "In stock", value: stock.in_stock, fill: STOCK_SERIES.available },
          { label: "Low stock", value: stock.low, fill: STOCK_SERIES.low },
          { label: "Out of stock", value: stock.out, fill: STOCK_SERIES.out },
        ]}
        emptyText="No drugs on the formulary yet."
      />
      {stock.low_items.length > 0 && (
        <ul aria-label="Drugs to reorder" className="flex flex-col">
          {stock.low_items.map((item) => (
            <li
              key={item.drug}
              className="border-line flex items-center gap-3 border-t py-2.5 first:border-t-0"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-ink-900 truncate">{item.name}</span>
                <span className="text-small text-ink-600 tnum">
                  {item.available} left · reorder at {item.reorder_level}
                </span>
              </span>
              <StatusPill status={item.available > 0 ? STOCK_LEVEL.low : STOCK_LEVEL.out} />
              <Link
                href={stockHref({ tab: "orders", order: item.drug })}
                aria-label={`Order ${item.name}`}
                className={LINK}
              >
                Order
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
