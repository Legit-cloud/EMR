"use client";

import { Suspense } from "react";

import { WardBoard } from "@/components/inpatient/ward-board";
import { Loading } from "@/components/ui/skeleton";

export default function InpatientPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<Loading label="Loading wards">{null}</Loading>}>
      <WardBoard />
    </Suspense>
  );
}
