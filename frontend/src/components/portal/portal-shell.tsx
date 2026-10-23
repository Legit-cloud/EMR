"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LogoMark, PRODUCT_NAME } from "@/components/layout/logo";
import { FOCUS_RING } from "@/components/ui/focus";
import { cx } from "@/lib/cx";

import { PortalButton } from "./shared";

export const PORTAL_NAV = [
  { label: "Home", href: "/portal" },
  { label: "Appointments", href: "/portal/appointments" },
  { label: "Results", href: "/portal/results" },
  { label: "Prescriptions", href: "/portal/prescriptions" },
  { label: "Invoices", href: "/portal/invoices" },
  { label: "Profile", href: "/portal/profile" },
  { label: "Your rights", href: "/portal/rights" },
] as const;

/** The nav item for a path: Home only matches exactly, the rest by prefix. */
export function activePortalItem(pathname: string) {
  return PORTAL_NAV.find((item) =>
    item.href === "/portal" ? pathname === "/portal" : pathname.startsWith(item.href),
  );
}

/**
 * The patient portal's lighter shell (docs/DESIGN.md Section 8): top navigation instead of a
 * sidebar, 16 px body text and 44 px touch targets, built for a phone first. The navigation
 * scrolls sideways on a narrow screen rather than collapsing into a hidden menu.
 */
export function PortalShell({
  name,
  onSignOut,
  children,
}: {
  name: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="bg-canvas flex min-h-screen flex-col text-base">
      <a
        href="#main"
        className={cx(
          "bg-surface rounded-control shadow-pop sr-only z-50 p-3 text-blue-600 focus:not-sr-only focus:absolute focus:top-2 focus:left-2",
          FOCUS_RING,
        )}
      >
        Skip to content
      </a>
      <header className="border-line bg-surface border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href="/portal"
            className={cx("rounded-control flex min-h-11 items-center gap-2", FOCUS_RING)}
          >
            <LogoMark size={28} />
            <span className="text-card-title text-ink-900">{PRODUCT_NAME}</span>
            <span className="text-small text-ink-600 hidden sm:inline">Patient portal</span>
          </Link>
          <span className="text-small text-ink-600 ml-auto hidden truncate sm:inline">{name}</span>
          <PortalButton variant="neutral" onClick={onSignOut} className="ml-auto sm:ml-0">
            Sign out
          </PortalButton>
        </div>
        <nav aria-label="Portal" className="mx-auto max-w-3xl overflow-x-auto px-2">
          <ul className="flex gap-1">
            {PORTAL_NAV.map((item) => {
              const current = activePortalItem(pathname)?.href === item.href;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "text-body -mb-px flex min-h-11 items-center border-b-2 px-3 font-semibold whitespace-nowrap",
                      current
                        ? "border-blue-600 text-blue-600"
                        : "text-ink-600 hover:text-ink-900 border-transparent",
                      FOCUS_RING,
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="text-small text-ink-500 mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-6">
        <p>
          In an emergency, go to the nearest hospital or call your local emergency number. Do not
          wait for a message from this portal.
        </p>
        <Link
          href="/portal/privacy"
          className={cx(
            "rounded-control inline-flex min-h-11 items-center font-semibold text-blue-600 underline",
            FOCUS_RING,
          )}
        >
          How we use your information
        </Link>
      </footer>
    </div>
  );
}
