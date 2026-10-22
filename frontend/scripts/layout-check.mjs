/**
 * Opens every screen at the four design widths and reports any that scroll sideways.
 * Runs against `next dev` with the mock layer on, so it needs no backend:
 *
 *   NEXT_PUBLIC_USE_MOCKS=true pnpm dev &
 *   node scripts/layout-check.mjs
 *
 * Screenshots go to test-results/layout/. Exit code 1 if any screen overflows the page.
 * A signed-in mock session lives in the page, so screens are reached by client-side navigation
 * (window.next.router) rather than by reloading.
 */
import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const PASSWORD = "synthetic-password-1";
const CODE = "123456";
const CHART = "/patients/8a5e2f8c-0000-4000-8000-000000000001";

const GROUPS = [
  {
    user: "bisi.finance",
    routes: [
      "/dashboard",
      "/patients",
      CHART,
      "/appointments",
      "/queue",
      "/billing",
      "/pharmacy/stock",
      "/staff",
      "/inpatient",
      "/admin/audit",
      "/compliance",
      "/manage",
      "/registrations",
      "/pharmacy/formulary",
    ],
  },
  {
    user: "chioma.patient",
    routes: [
      "/portal",
      "/portal/appointments",
      "/portal/results",
      "/portal/prescriptions",
      "/portal/invoices",
      "/portal/profile",
    ],
  },
];

async function waitForServer() {
  for (let i = 0; i < 300; i += 1) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("The dev server did not start.");
}

async function signIn(page, user) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").fill(user);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Sign-in code").fill(CODE);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** Elements wider than the window that are not inside a scroll container of their own. */
function overflowing() {
  const limit = window.innerWidth + 1;
  const scrolls = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const x = getComputedStyle(node).overflowX;
      if (x === "auto" || x === "scroll" || x === "hidden") return true;
    }
    return false;
  };
  return [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > limit && !scrolls(el))
    .slice(0, 4)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
}

mkdirSync("test-results/layout", { recursive: true });
await waitForServer();
const browser = await chromium.launch();
const failures = [];
let checked = 0;

for (const size of WIDTHS) {
  for (const group of GROUPS) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    await signIn(page, group.user);
    for (const route of group.routes) {
      await page.evaluate((path) => window.next.router.push(path), route);
      await page.waitForURL((url) => url.pathname === route, { timeout: 30_000 });
      // Let the first requests and the skeletons settle.
      await page.waitForTimeout(1500);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      checked += 1;
      if (sideways > 1) {
        const where = await page.evaluate(overflowing);
        failures.push(
          `${size.width}px ${route}: page is ${sideways}px too wide  ${where.join(" | ")}`,
        );
      }
      if (size.width === 390 || size.width === 1440) {
        const name = route.replaceAll("/", "_").replace(/^_/, "") || "home";
        await page.screenshot({ path: `test-results/layout/${size.width}-${name}.png` });
      }
    }
    await context.close();
  }
}
await browser.close();

console.log(`${checked} screens checked at ${WIDTHS.map((w) => w.width).join(", ")} px.`);
if (failures.length) {
  console.log(`${failures.length} scroll sideways:`);
  for (const line of failures) console.log(`  ${line}`);
  process.exit(1);
}
console.log("None scroll sideways.");
