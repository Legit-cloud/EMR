import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./src/mocks/server";

// findBy and waitFor give up after 1 s by default; this host is often much slower under load.
configure({ asyncUtilTimeout: 10_000 });

// jsdom lacks the pointer-capture, scrolling and resize APIs Radix popovers call.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does no layout, so Recharts' ResponsiveContainer measures 0 x 0 and warns on every
// chart. The charts' text summaries and tables are what the tests check.
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("of chart should be greater than 0")) return;
  warn(...args);
};

// Unit tests never reach a real API: unknown requests fail loudly.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
