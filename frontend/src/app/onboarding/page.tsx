"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { OnboardingWizard } from "@/components/signup/onboarding-wizard";
import { api } from "@/lib/api";

/** The questions after sign-up. Needs a session: anyone else is sent to sign in. */
export default function OnboardingPage() {
  const router = useRouter();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/accounts/auth/me/");
      return response.ok && data ? data : null;
    },
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (me.isSuccess && me.data === null) router.replace("/login?next=/onboarding");
  }, [me.isSuccess, me.data, router]);

  if (!me.data) {
    return (
      <main className="p-6">
        <p role="status" className="text-body text-ink-600">
          Checking your session…
        </p>
      </main>
    );
  }
  return <OnboardingWizard />;
}
