/**
 * Typed API client generated from the backend's OpenAPI schema (src/lib/schema.d.ts).
 *
 * Regenerate after an API change:  make openapi  (exports openapi.yaml and the types).
 *
 * The API decides who may see and do what. The client never hides data as a security
 * measure: a 403 is shown to the user as "no access".
 */
import createClient, { type Middleware } from "openapi-fetch";

import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")[1];
}

/** Django's CSRF check: unsafe requests echo the csrftoken cookie in a header. */
const csrf: Middleware = {
  onRequest({ request }) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const token = cookie("csrftoken");
      if (token) request.headers.set("X-CSRFToken", decodeURIComponent(token));
    }
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: "", credentials: "same-origin" });
api.use(csrf);

/** The standard error body of the API: {"error": {"code", "message", "details"}}. */
export type ApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export function apiError(error: unknown): ApiError {
  const body = (error as { error?: ApiError } | undefined)?.error;
  return body ?? { code: "error", message: "Something went wrong. Try again.", details: {} };
}

/** Field errors from a validation error, as {field: "message"}. */
export function fieldErrors(error: ApiError): Record<string, string> {
  if (error.code !== "validation_error") return {};
  return Object.fromEntries(
    Object.entries(error.details).map(([field, messages]) => [
      field,
      Array.isArray(messages) ? String(messages[0]) : String(messages),
    ]),
  );
}

/** Make sure the CSRF cookie exists before the first unsafe request (sign-in). */
export async function ensureCsrfCookie(): Promise<void> {
  if (!cookie("csrftoken")) await api.GET("/api/accounts/auth/csrf/");
}
