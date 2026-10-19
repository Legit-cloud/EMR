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

/** Codes meaning the session is gone or never finished signing in. */
const SIGNED_OUT_CODES = new Set(["not_authenticated", "authentication_failed", "mfa_required"]);

let onSignedOut: (() => void) | null = null;

/**
 * Called once when an API request finds the session gone (401, or a 403 saying the user
 * is not signed in). The signed-in app registers a redirect to the sign-in page; the
 * sign-in pages register nothing, so a wrong password stays on the form.
 */
export function setSignedOutHandler(handler: (() => void) | null): void {
  onSignedOut = handler;
}

const signedOut: Middleware = {
  async onResponse({ response }) {
    if (!onSignedOut || (response.status !== 401 && response.status !== 403)) return;
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    const code = (body as { error?: ApiError } | null)?.error?.code ?? "";
    if (response.status === 401 || SIGNED_OUT_CODES.has(code)) onSignedOut();
  },
};

export const api = createClient<paths>({
  // Empty means the same origin: the edge proxy serves the app and the API together.
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  credentials: "same-origin",
  // Look fetch up per request, so mock layers installed after this module loads apply.
  fetch: (request) => globalThis.fetch(request),
});
api.use(csrf, signedOut);

/** The standard error body of the API: {"error": {"code", "message", "details"}}. */
export type ApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

const FALLBACK: ApiError = {
  code: "error",
  message: "Something went wrong. Try again.",
  details: {},
};

export function apiError(error: unknown): ApiError {
  if (error instanceof ApiRequestError) return error.body;
  const body = (error as { error?: ApiError } | undefined)?.error;
  return body ?? FALLBACK;
}

/** A failed request, thrown by `unwrap` so TanStack Query sees it as an error. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
    this.name = "ApiRequestError";
  }

  get code(): string {
    return this.body.code;
  }
}

/**
 * The data of a successful request, or throws ApiRequestError. Use it in query and
 * mutation functions:  queryFn: () => unwrap(api.GET("/api/...")).
 */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok) throw new ApiRequestError(response.status, apiError(error));
  return data as T;
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
