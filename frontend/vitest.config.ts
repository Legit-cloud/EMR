import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Node's fetch needs absolute URLs; MSW answers them all.
    env: { NEXT_PUBLIC_API_URL: "http://localhost" },
    // The checks run in Docker over a bind-mounted folder; with every file running in
    // parallel, a file's first test (which also loads jsdom and the icon set) can pass 5 s.
    // Multi-step sign-in tests took 17 s in a full parallel run on this 7.8 GB host.
    testTimeout: 30_000,
  },
});
