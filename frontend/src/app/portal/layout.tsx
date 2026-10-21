"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { PortalShell } from "@/components/portal/portal-shell";
import { Loading } from "@/components/ui/skeleton";
import { api, setSignedOutHandler } from "@/lib/api";
import { SessionContext } from "@/lib/session";

/** The patient portal: its own lighter shell, outside the staff app's sidebar layout. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/accounts/auth/me/");
      return response.ok && data ? data : null;
    },
    staleTime: 5 * 60_000,
  });

  const leaving = useRef(false);
  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => {
    if (signedOut && !leaving.current) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [signedOut, router, pathname]);

  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);
  const signedIn = !!me.data;
  useEffect(() => {
    if (!signedIn) return;
    setSignedOutHandler(() => {
      if (leaving.current) return;
      leaving.current = true;
      router.replace(`/login?reason=expired&next=${encodeURIComponent(here.current)}`);
      queryClient.clear();
    });
    return () => setSignedOutHandler(null);
  }, [signedIn, queryClient, router]);

  const signOut = useCallback(async () => {
    leaving.current = true;
    setSignedOutHandler(null);
    await api.POST("/api/accounts/auth/logout/");
    router.replace("/login");
    queryClient.clear();
  }, [queryClient, router]);

  if (!me.data) {
    return (
      <main className="p-6">
        <Loading label="Checking your session">{null}</Loading>
      </main>
    );
  }

  // Convenience only: the portal API itself refuses anyone who is not the patient.
  if (!me.data.roles.includes("patient")) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-6 text-base">
        <h1 className="text-page-title text-ink-900">This area is for patients</h1>
        <p className="text-ink-600">
          You are signed in as staff. The patient portal shows a patient their own records.
        </p>
        <Link href="/dashboard" className="min-h-11 font-semibold text-blue-600 underline">
          Go to the staff app
        </Link>
      </main>
    );
  }

  const name =
    [me.data.first_name, me.data.last_name].filter(Boolean).join(" ") || me.data.username;
  return (
    <SessionContext.Provider value={me.data}>
      <PortalShell name={name} onSignOut={signOut}>
        {children}
      </PortalShell>
    </SessionContext.Provider>
  );
}
