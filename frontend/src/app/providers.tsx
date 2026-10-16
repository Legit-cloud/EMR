"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { startMocks, useMocks } from "@/lib/mocks";

/** App-wide providers. Query defaults (retries, stale times) are set in F5. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [ready, setReady] = useState(!useMocks);

  useEffect(() => {
    if (useMocks) startMocks().then(() => setReady(true));
  }, []);

  if (!ready) return null;
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
