import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the docker compose stack (edge proxy in front of Django and
 * Next.js). Run with `make e2e`, which seeds a fresh synthetic tenant first.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Tablet width: the screens must work on ward and front-desk tablets.
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } },
    },
  ],
});
