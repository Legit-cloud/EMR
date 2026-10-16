import type { HttpHandler } from "msw";

/**
 * Mock API handlers, shaped like the OpenAPI schema (src/lib/schema.d.ts).
 *
 * Release 1 screens use the real API. Handlers here serve unit tests, and screens
 * whose backend is not built yet are left out rather than mocked as if they worked.
 */
export const handlers: HttpHandler[] = [];
