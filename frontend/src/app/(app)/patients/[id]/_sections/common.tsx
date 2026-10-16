"use client";

import type { ReactNode } from "react";

import { Loading, NoAccess } from "@/components/legacy-ui";
import type { Loaded } from "@/lib/useLoad";

/** Render a section's data, or its loading / no-access state. */
export function Show<T>({ value, children }: { value: Loaded<T>; children: (v: T) => ReactNode }) {
  if (value === undefined) return <Loading />;
  if (value === "forbidden") return <NoAccess />;
  return <>{children(value)}</>;
}

/** Small text button for row actions. */
export function RowAction({ children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="min-h-9 rounded px-2 text-sm font-medium text-teal-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
    >
      {children}
    </button>
  );
}
