"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, isNotAvailable } from "@/lib/api";
import { cx } from "@/lib/cx";

/** Page title and an optional line under it, at portal size. */
export function PortalHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mb-5 flex flex-col gap-1">
      <h1 className="text-page-title text-ink-900">{title}</h1>
      {lead && <p className="text-base text-ink-600">{lead}</p>}
    </header>
  );
}

/** White card at portal size. */
export function PortalCard({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cx(
        "rounded-card border-line bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-5",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-card-title text-ink-900">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** A button at least 44 px tall, for touch. */
export function PortalButton({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof Button> & { variant?: ButtonVariant }) {
  return <Button variant={variant} className={cx("min-h-11 min-w-11", className)} {...props} />;
}

/**
 * Loading, error, no-access and empty states for one portal query; the page shows its content
 * only when there is data. A 404 means the portal is not switched on for this clinic yet.
 */
export function QueryState<T>({
  query,
  what,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  what: string;
  empty: string;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <Loading label={`Loading ${what}`}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Loading>
    );
  }
  if (query.error instanceof ApiRequestError && query.error.status === 403) {
    return <NoAccess what={what} compact />;
  }
  if (query.isError) {
    return (
      <PortalCard>
        <EmptyState
          title={
            isNotAvailable(query.error)
              ? "The patient portal is not available yet."
              : `Your ${what} could not be loaded.`
          }
          action={
            isNotAvailable(query.error) ? undefined : (
              <PortalButton variant="outline" onClick={() => query.refetch()}>
                Try again
              </PortalButton>
            )
          }
        />
      </PortalCard>
    );
  }
  if (isEmpty ? isEmpty(query.data as T) : Array.isArray(query.data) && query.data.length === 0) {
    return (
      <PortalCard>
        <EmptyState title={empty} />
      </PortalCard>
    );
  }
  return <>{children(query.data as T)}</>;
}
