"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Loading } from "@/components/ui/skeleton";

/** The registration form is now a wizard on the patients screen; old links still work. */
export default function RegisterPatientRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/patients?new=1");
  }, [router]);
  return <Loading label="Opening registration">{null}</Loading>;
}
