"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Loading } from "@/components/ui/skeleton";

/** The appointments calendar now lives at /appointments; old links still arrive here. */
export default function ScheduleRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/appointments");
  }, [router]);
  return <Loading label="Opening appointments">{null}</Loading>;
}
