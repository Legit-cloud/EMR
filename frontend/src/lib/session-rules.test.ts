import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { server } from "@/mocks/server";

import { api, ApiRequestError, setSignedOutHandler, unwrap } from "./api";
import { permissionsFor } from "./permissions";
import { createQueryClient, shouldRetry } from "./query";
import { useIdleTimeout } from "./use-idle-timeout";

const refusal = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, details: {} } }, { status });

afterEach(() => {
  setSignedOutHandler(null);
  vi.useRealTimers();
});

describe("signed-out handling", () => {
  it("calls the handler when the session is gone (401 or a not-signed-in 403)", async () => {
    const handler = vi.fn();
    setSignedOutHandler(handler);
    resetAuthMocks(); // nobody signed in: /me answers 401
    await api.GET("/api/accounts/auth/me/");
    expect(handler).toHaveBeenCalledTimes(1);

    server.use(http.get("*/api/accounts/auth/me/", () => refusal(403, "mfa_required")));
    await api.GET("/api/accounts/auth/me/");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("leaves ordinary refusals to the screen", async () => {
    const handler = vi.fn();
    setSignedOutHandler(handler);
    server.use(http.get("*/api/accounts/auth/me/", () => refusal(403, "permission_denied")));
    await api.GET("/api/accounts/auth/me/");
    expect(handler).not.toHaveBeenCalled();
  });

  it("unwrap throws a typed error carrying the status and the API error body", async () => {
    server.use(http.get("*/api/accounts/auth/me/", () => refusal(403, "permission_denied")));
    const failure = await unwrap(api.GET("/api/accounts/auth/me/")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).status).toBe(403);
    expect((failure as ApiRequestError).code).toBe("permission_denied");
  });
});

describe("query defaults", () => {
  const apiFailure = (status: number) =>
    new ApiRequestError(status, { code: "x", message: "Save failed.", details: {} });

  it("retries network and server errors twice, never a 4xx", () => {
    expect(shouldRetry(0, apiFailure(404))).toBe(false);
    expect(shouldRetry(0, apiFailure(403))).toBe(false);
    expect(shouldRetry(0, apiFailure(503))).toBe(true);
    expect(shouldRetry(1, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(2, apiFailure(503))).toBe(false);
  });

  it("toasts failed saves, except refusals and forms that show their own errors", async () => {
    const notify = vi.fn();
    const client = createQueryClient(notify);
    const run = (error: Error, quietErrors = false) =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(error), meta: { quietErrors } })
        .execute(undefined)
        .catch(() => undefined);

    await run(apiFailure(500));
    expect(notify).toHaveBeenLastCalledWith("Save failed.");
    await run(apiFailure(403));
    await run(apiFailure(400), true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("toasts a failed background refresh but not a failed first load", async () => {
    const notify = vi.fn();
    const client = createQueryClient(notify);
    const fail = () => Promise.reject(apiFailure(500));
    const options = { queryFn: fail, retry: false } as const;

    await client.fetchQuery({ queryKey: ["first"], ...options }).catch(() => undefined);
    expect(notify).not.toHaveBeenCalled();

    client.setQueryData(["loaded"], { ok: true });
    await client.fetchQuery({ queryKey: ["loaded"], ...options, staleTime: 0 }).catch(() => {});
    expect(notify).toHaveBeenCalledWith("Could not refresh. Showing the last data loaded.");
  });
});

describe("permissionsFor (SEC-02: interface hints only)", () => {
  const doctor = MOCK_USERS["ada.doctor"];
  const { facility, department } = doctor.assignments[0];

  it("reads roles, assignments, duty and break-glass from /auth/me", () => {
    const p = permissionsFor(doctor);
    expect(p.hasRole("doctor")).toBe(true);
    expect(p.hasRole("pharmacist", "nurse")).toBe(false);
    expect(p.inFacility(facility!)).toBe(true);
    expect(p.inFacility("another-facility")).toBe(false);
    expect(p.inDepartment(department!, facility!)).toBe(true);
    expect(p.inDepartment("another-department", facility!)).toBe(false);
    expect(p.onDuty).toBe(true);
    expect(p.canBreakGlass).toBe(true);
  });

  it("treats an assignment without a department as covering its facility", () => {
    const desk = permissionsFor(MOCK_USERS["tunde.desk"]);
    const deskFacility = MOCK_USERS["tunde.desk"].assignments[0].facility!;
    expect(desk.inDepartment("any-department", deskFacility, "front_desk")).toBe(true);
    expect(desk.inDepartment("any-department", deskFacility, "doctor")).toBe(false);
    expect(desk.canBreakGlass).toBe(false);
  });
});

describe("useIdleTimeout", () => {
  const LIMIT = 15 * 60_000;

  it("warns two minutes before the limit, then times out once", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleTimeout({ onTimeout }));

    act(() => vi.advanceTimersByTime(LIMIT - 2 * 60_000 - 1000));
    expect(result.current.warning).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.warning).toBe(true);

    // Passive activity does not dismiss the warning: only "Stay signed in" does.
    act(() => void window.dispatchEvent(new Event("keydown")));
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(onTimeout).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("restarts the clock on activity and on 'Stay signed in'", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleTimeout({ onTimeout }));

    act(() => vi.advanceTimersByTime(10 * 60_000));
    act(() => void window.dispatchEvent(new Event("pointerdown")));
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(result.current.warning).toBe(false);

    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(result.current.warning).toBe(true);
    act(() => result.current.stayActive());
    expect(result.current.warning).toBe(false);
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
