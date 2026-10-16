"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PageContainer } from "@/components/layout/page-container";
import type { Facility } from "@/components/layout/sidebar";
import { Loading } from "@/components/legacy-ui";
import { api } from "@/lib/api";
import { SessionContext } from "@/lib/session";

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

  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => {
    if (signedOut) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, router, pathname]);

  async function signOut() {
    await api.POST("/api/accounts/auth/logout/");
    queryClient.clear();
    router.replace("/login");
  }

  if (!me.data) {
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
        onSignOut={signOut}
      >
        <PageContainer>{children}</PageContainer>
      </AppShell>
    </SessionContext.Provider>
  );
}
