"use client";

import Link from "next/link";

import { visibleNav } from "@/components/layout/nav-config";
import { PageGreeting } from "@/components/layout/page-container";
import { FOCUS_RING } from "@/components/ui/focus";
import { useMe } from "@/lib/session";

/** The greeting and shortcuts to the screens this user works in. */
export default function DashboardPage() {
  const me = useMe();
  const shortcuts = visibleNav(me.roles)
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/dashboard");

  return (
    <>
      <PageGreeting name={me.first_name || me.username} />
      <section
        aria-labelledby="shortcuts"
        className="rounded-card border-line bg-surface shadow-card flex flex-col gap-4 border p-5"
      >
        <h2 id="shortcuts" className="text-card-title text-ink-900">
          Your work
        </h2>
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
      </section>
    </>
  );
}
