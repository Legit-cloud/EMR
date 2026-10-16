"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { SessionContext, type Me } from "@/lib/session";

const NAV = [
  { href: "/patients", label: "Patients" },
  { href: "/schedule", label: "Schedule" },
  { href: "/queue", label: "Queue" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.GET("/api/accounts/auth/me/").then(({ data, response }) => {
      if (cancelled) return;
      if (response.status === 401 || response.status === 403 || !data) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setMe(data);
    });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  async function signOut() {
    await api.POST("/api/accounts/auth/logout/");
    router.replace("/login");
  }

  if (!me) {
    return (
      <main className="p-6">
        <Loading label="Checking your session" />
      </main>
    );
  }

  return (
    <SessionContext.Provider value={me}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-lg font-semibold text-teal-800">EMR</span>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {NAV.map((item) => {
              const current = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${current ? "bg-teal-50 text-teal-900" : "text-slate-700 hover:bg-slate-100"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span data-testid="signed-in-user">
              {[me.first_name, me.last_name].filter(Boolean).join(" ") || me.username}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="min-h-11 rounded-md px-3 text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl p-4">
        {children}
      </main>
    </SessionContext.Provider>
  );
}
