"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { MyTasksCard, WaitingQueueCard } from "@/components/dashboard/clinical";
import {
  BilledCollectedCard,
  CashflowCard,
  type DashboardRange,
  RevenueMixCard,
} from "@/components/dashboard/finance";
import { PatientsCard, PopularServicesCard, StockCard } from "@/components/dashboard/operations";
import { visibleNav } from "@/components/layout/nav-config";
import { PageGreeting } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FOCUS_RING } from "@/components/ui/focus";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { cx } from "@/lib/cx";
import { usePermissions } from "@/lib/permissions";
import { useMe } from "@/lib/session";

/**
 * The dashboard (docs/DESIGN.md Section 8). The API decides which cards a user gets: each
 * is null unless the role sees that data across the whole tenant. Finance and operations
 * cards come from real totals; cards with no data source yet (expenses, results to review,
 * service ratings) are left out rather than mocked.
 */
export default function DashboardPage() {
  const me = useMe();
  const permissions = usePermissions();
  const [range, setRange] = useState<DashboardRange>("12m");
  const dashboard = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => unwrap(api.GET("/api/reports/dashboard/", { params: { query: { range } } })),
    placeholderData: (previous) => previous,
  });

  const data = dashboard.data;
  const doctor = permissions.hasRole("doctor");

  return (
    <>
      <PageGreeting name={me.first_name || me.username} />
      {dashboard.isError && !data ? (
        <Card title="Dashboard">
          <p className="text-body text-ink-600">The dashboard could not be loaded.</p>
          <div>
            <Button variant="outline" onClick={() => dashboard.refetch()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {data.my_day && (
            <div className="grid gap-5 lg:grid-cols-12">
              {doctor && <WaitingQueueCard physicianId={me.id} />}
              <MyTasksCard
                myDay={data.my_day}
                className={doctor ? "lg:col-span-4" : "lg:col-span-12"}
              />
            </div>
          )}

          {data.finance && (
            <div className="grid gap-5 lg:grid-cols-12">
              <CashflowCard finance={data.finance} range={range} onRangeChange={setRange} />
              <RevenueMixCard finance={data.finance} />
              <BilledCollectedCard finance={data.finance} range={range} />
              {data.stock && <StockCard stock={data.stock} className="lg:col-span-4" />}
            </div>
          )}

          {(data.patients || data.popular_services || (data.stock && !data.finance)) && (
            <div
              className={cx(
                "grid gap-5 md:grid-cols-2",
                // Three columns only when all three cards are here; otherwise two fill the row.
                data.patients && data.popular_services && data.stock && !data.finance
                  ? "xl:grid-cols-3"
                  : undefined,
              )}
            >
              {data.patients && <PatientsCard mix={data.patients} />}
              {data.popular_services && <PopularServicesCard services={data.popular_services} />}
              {data.stock && !data.finance && <StockCard stock={data.stock} />}
            </div>
          )}

          {!data.finance &&
            !data.patients &&
            !data.popular_services &&
            !data.stock &&
            !data.my_day && <Shortcuts roles={me.roles} />}
        </>
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <Loading label="Loading the dashboard">
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="rounded-card h-80 lg:col-span-8" />
        <Skeleton className="rounded-card h-80 lg:col-span-4" />
        <Skeleton className="rounded-card h-64 lg:col-span-6" />
        <Skeleton className="rounded-card h-64 lg:col-span-6" />
      </div>
    </Loading>
  );
}

/** For roles with no dashboard figures (HR, compliance): links to their screens. */
function Shortcuts({ roles }: { roles: string[] }) {
  const shortcuts = visibleNav(roles)
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/dashboard");
  return (
    <Card title="Your work">
      {shortcuts.length === 0 ? (
        <p className="text-body text-ink-600">
          Your account has no roles yet. Ask your administrator to add one.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`rounded-control border-line hover:bg-nav-hover text-body text-ink-900 flex items-center gap-3 border p-3 font-semibold ${FOCUS_RING}`}
                >
                  <span className="rounded-control grid size-10 shrink-0 place-items-center bg-blue-100 text-blue-600">
                    <Icon aria-hidden size={24} weight="duotone" />
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
