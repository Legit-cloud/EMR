/**
 * Opens every staff and portal screen at the four design widths on the real stack, and reports
 * any that scroll sideways or fail to draw. Run it in the Playwright container after the stack is
 * up and a tenant is seeded (`make e2e` does both), so e2e/.seed.json and the saved sign-ins in
 * e2e/.auth/ exist:
 *
 *   docker compose --profile e2e run --rm --no-deps playwright \
 *     sh -c "corepack enable && pnpm install --frozen-lockfile >/dev/null && node scripts/layout-check.mjs"
 *
 * Screenshots go to test-results/layout/. Exit code 1 if any screen overflows the page.
 */
import { mkdirSync, readFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const seed = JSON.parse(readFileSync("e2e/.seed.json", "utf-8"));

const GROUPS = [
  {
    role: "admin",
    routes: [
      "/dashboard",
      "/patients",
      `/patients/${seed.patient.id}`,
      "/appointments",
      "/queue",
      "/billing",
      `/billing?invoice=${seed.invoice_id}`,
      "/pharmacy/stock",
      "/pharmacy/stock?tab=orders",
      "/staff",
      "/inpatient",
      "/audit",
      "/compliance",
      "/manage",
      "/manage/staff",
      "/registrations",
      "/pharmacy/formulary",
    ],
  },
  {
    role: "portal",
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

const slug = (route) => route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";

mkdirSync("test-results/layout", { recursive: true });
const browser = await chromium.launch();
const failures = [];
let checked = 0;

for (const size of WIDTHS) {
  for (const group of GROUPS) {
    const context = await browser.newContext({
      viewport: size,
      baseURL: BASE,
      storageState: `e2e/.auth/${group.role}.json`,
    });
    const page = await context.newPage();
    for (const route of group.routes) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(800);
      checked += 1;
      const where = `${size.width}px ${route}`;
      if (!response || response.status() >= 400) {
        failures.push(`${where}: HTTP ${response?.status()}`);
        continue;
      }
      if (new URL(page.url()).pathname.startsWith("/login")) {
        failures.push(`${where}: sent to sign-in`);
        continue;
      }
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (sideways > 1) {
        const culprits = await page.evaluate(overflowing);
        failures.push(`${where}: page is ${sideways}px too wide  ${culprits.join(" | ")}`);
      }
      if (size.width === 390 || size.width === 1440) {
        await page.screenshot({ path: `test-results/layout/${size.width}-${slug(route)}.png` });
      }
    }
    await context.close();
  }
}
await browser.close();

console.log(`${checked} screens checked at ${WIDTHS.map((w) => w.width).join(", ")} px.`);
if (failures.length) {
  console.log(`${failures.length} problem(s):`);
  for (const line of failures) console.log(`  ${line}`);
  process.exit(1);
}
console.log("None scroll sideways.");
