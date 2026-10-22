"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { IdleWarning } from "@/components/auth/idle-warning";
import { AppShell } from "@/components/layout/app-shell";
import { PageContainer } from "@/components/layout/page-container";
import type { Facility } from "@/components/layout/sidebar";
import { Loading } from "@/components/legacy-ui";
import { api, setSignedOutHandler } from "@/lib/api";
import { SessionContext } from "@/lib/session";
import { useIdleTimeout } from "@/lib/use-idle-timeout";

const FACILITY_KEY = "emr.facility";

function storedFacility(): string | null {
  try {
    return window.localStorage.getItem(FACILITY_KEY);
  } catch {
    return null;
  }
}

function storeFacility(id: string): void {
  try {
    window.localStorage.setItem(FACILITY_KEY, id);
  } catch {
    // Storage can be blocked; the choice then lasts for this visit only.
  }
}

export default function AppLayout({ children }: { children: ReactNode }) {
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
  const facilities = useQuery({
    queryKey: ["facilities"],
    queryFn: async () => (await api.GET("/api/tenants/facilities/")).data?.results ?? [],
    enabled: !!me.data,
    staleTime: 5 * 60_000,
  });
  // The facility shown in the switcher, remembered in this browser. Records are not
  // filtered by it yet: the API has no "current facility" setting.
  const [facilityId, setFacilityId] = useState(storedFacility);

  // Set once this layout has sent the user to sign in, so clearing the cache (which makes
  // /me answer "no session") does not redirect a second time and lose the reason.
  const leaving = useRef(false);
  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => {
    if (signedOut && !leaving.current) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [signedOut, router, pathname]);

  // A patient belongs in the portal, not the staff app (the API refuses them staff data anyway).
  const patientOnly = !!me.data && me.data.roles.every((role) => role === "patient");
  useEffect(() => {
    if (patientOnly) router.replace("/portal");
  }, [patientOnly, router]);

  // Any request that finds the session gone (expired, revoked, signed out in another tab)
  // sends the user to sign in and back here afterwards.
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);
  // Armed only once signed in: a first visit without a session is not an "ended" session.
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

  const signOut = useCallback(
    async (reason?: "idle") => {
      leaving.current = true;
      setSignedOutHandler(null);
      await api.POST("/api/accounts/auth/logout/");
      router.replace(reason ? `/login?reason=${reason}` : "/login");
      queryClient.clear();
    },
    [queryClient, router],
  );
  const idle = useIdleTimeout({ onTimeout: () => signOut("idle") });

  if (!me.data || patientOnly) {
    return (
      <main className="p-6">
        <Loading label="Checking your session" />
      </main>
    );
  }

  const list: Facility[] = facilities.data ?? [];
  const current = list.find((f) => f.id === facilityId) ?? list[0] ?? null;
  const name =
    [me.data.first_name, me.data.last_name].filter(Boolean).join(" ") || me.data.username;

  return (
    <SessionContext.Provider value={me.data}>
      <AppShell
        user={{ name, roles: me.data.roles }}
        facility={{
          facilities: list,
          current,
          onSelect: (f) => {
            storeFacility(f.id);
            setFacilityId(f.id);
          },
        }}
        onSignOut={() => signOut()}
      >
        <PageContainer>{children}</PageContainer>
      </AppShell>
      {idle.warning && (
        <IdleWarning
          deadline={idle.deadline}
          onStay={idle.stayActive}
          onSignOut={() => signOut()}
        />
      )}
    </SessionContext.Provider>
  );
}
