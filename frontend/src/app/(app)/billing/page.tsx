"use client";

import { Suspense } from "react";

import { BillingScreen } from "@/components/billing/billing-screen";
import { Loading } from "@/components/ui/skeleton";

export default function BillingPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<Loading label="Loading billing">{null}</Loading>}>
      <BillingScreen />
    </Suspense>
  );
}
