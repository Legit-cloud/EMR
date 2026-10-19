import type { HttpHandler } from "msw";

import { authHandlers } from "./auth";
import { dashboardHandlers } from "./dashboard";

/**
 * Mock API handlers, shaped like the OpenAPI schema (src/lib/schema.d.ts).
 *
 * Release 1 screens use the real API. Handlers here serve unit tests and let sign-in run
 * without a backend; screens whose backend is not built yet are left out rather than
 * mocked as if they worked.
 */
export const handlers: HttpHandler[] = [...authHandlers, ...dashboardHandlers];
