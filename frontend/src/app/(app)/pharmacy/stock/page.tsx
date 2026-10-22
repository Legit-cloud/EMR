"use client";

import { Suspense } from "react";

import { StockScreen } from "@/components/stock/stock-screen";
import { Loading } from "@/components/ui/skeleton";

export default function StockPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<Loading label="Loading stock">{null}</Loading>}>
      <StockScreen />
    </Suspense>
  );
}
