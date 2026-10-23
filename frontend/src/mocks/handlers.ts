import type { HttpHandler } from "msw";

import { appointmentHandlers } from "./appointments";
import { auditHandlers } from "./audit";
import { authHandlers } from "./auth";
import { billingHandlers } from "./billing";
import { chartHandlers } from "./chart";
import { dashboardHandlers } from "./dashboard";
import { dataRequestHandlers } from "./data-requests";
import { diagnosticsHandlers } from "./diagnostics";
import { inpatientHandlers } from "./inpatient";
import { patientHandlers } from "./patients";
import { pharmacyHandlers } from "./pharmacy";
import { portalHandlers } from "./portal";
import { staffHandlers } from "./staff";
import { stockHandlers } from "./stock";

/**
 * Mock API handlers, shaped like the OpenAPI schema (src/lib/schema.d.ts).
 *
 * Release 1 screens use the real API. Handlers here serve unit tests and let sign-in run
 * without a backend. Screens whose backend is planned (inpatient) are built against a mock
 * that states the contract; their pages say so when the API answers 404 (docs/adr/0020).
 */
export const handlers: HttpHandler[] = [
  ...appointmentHandlers,
  ...auditHandlers,
  ...authHandlers,
  ...billingHandlers,
  ...chartHandlers,
  ...dashboardHandlers,
  ...dataRequestHandlers,
  ...diagnosticsHandlers,
  ...inpatientHandlers,
  ...patientHandlers,
  ...portalHandlers,
  ...pharmacyHandlers,
  ...staffHandlers,
  ...stockHandlers,
];
