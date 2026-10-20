"use client";

import { Suspense, use } from "react";

import { PatientChart } from "@/components/chart/patient-chart";
import { Loading } from "@/components/ui/skeleton";

export default function PatientChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading label="Loading the chart">{null}</Loading>}>
      <PatientChart id={id} />
    </Suspense>
  );
}
