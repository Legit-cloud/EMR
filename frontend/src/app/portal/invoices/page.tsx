"use client";

import { Suspense } from "react";

import { PortalInvoices } from "@/components/portal/invoices";

export default function Page() {
  // The address carries ?reference= when Paystack sends the patient back, so it needs Suspense.
  return (
    <Suspense fallback={null}>
      <PortalInvoices />
    </Suspense>
  );
}
