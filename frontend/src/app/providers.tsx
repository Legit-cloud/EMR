"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { ToastProvider, useToast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { startMocks, useMocks } from "@/lib/mocks";
import { createQueryClient } from "@/lib/query";

/** Inside ToastProvider so failed saves and refreshes can raise a toast. */
function QueryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [client] = useState(() =>
    createQueryClient((message) => toast({ title: message, tone: "error" })),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** App-wide providers: toasts, query defaults (src/lib/query.ts) and tooltips. */
export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!useMocks);

  useEffect(() => {
    if (useMocks) startMocks().then(() => setReady(true));
  }, []);

  if (!ready) return null;
  return (
    <ToastProvider>
      <QueryProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryProvider>
    </ToastProvider>
  );
}
