"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";

/**
 * The old address of the prescription form. Prescribing now happens in a wizard on the
 * patient's chart, so this finds the patient of the visit and opens the chart with it.
 */
export default function NewPrescriptionRedirect() {
  return (
    <Suspense fallback={<Loading label="Opening the chart">{null}</Loading>}>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const router = useRouter();
  const encounter = useSearchParams().get("encounter") ?? "";
  const visit = useQuery({
    queryKey: ["encounter", encounter],
    enabled: encounter !== "",
    retry: false,
    queryFn: () =>
      unwrap(api.GET("/api/clinical/encounters/{id}/", { params: { path: { id: encounter } } })),
  });
  const patient = visit.data?.patient;
  useEffect(() => {
    if (patient) router.replace(`/patients/${patient}?prescribe=1`);
  }, [patient, router]);

  if (encounter === "" || visit.isError) {
    return <EmptyState title="Open a patient's chart to start a prescription." />;
  }
  return <Loading label="Opening the chart">{null}</Loading>;
}
