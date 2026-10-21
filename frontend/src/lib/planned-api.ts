/**
 * Requests for screens whose backend is not built yet (inpatient, patient portal).
 *
 * The typed client in `api.ts` only knows paths in the generated schema, so these screens
 * call this thin helper instead. It sends the same cookies and CSRF header and fails the same
 * way (`ApiRequestError`), so each screen's loading, error and no-access states are real.
 * Until the backend exists the paths are answered by the mock layer (NEXT_PUBLIC_USE_MOCKS);
 * without it the request returns 404 and the screen shows its "not available yet" state.
 *
 * When a module's API lands, regenerate the schema and replace these calls with `api`.
 */
import { ApiRequestError, apiError } from "./api";

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")[1];
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    const token = cookie("csrftoken");
    if (token) headers["X-CSRFToken"] = decodeURIComponent(token);
  }
  const response = await globalThis.fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw new ApiRequestError(response.status, apiError(payload));
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const planned = {
  get: <T>(path: string) => send<T>("GET", path),
  post: <T>(path: string, body?: unknown) => send<T>("POST", path, body ?? {}),
};

/** True when the server (or the lack of a backend) says this feature is not there. */
export function isNotAvailable(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 404 || error.status === 501);
}
