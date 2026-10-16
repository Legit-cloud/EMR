/**
 * The single mock switch. With NEXT_PUBLIC_USE_MOCKS=true the browser answers API
 * requests from src/mocks instead of the backend (development only).
 */
export const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export async function startMocks(): Promise<void> {
  if (!useMocks || typeof window === "undefined") return;
  const { worker } = await import("@/mocks/browser");
  await worker.start({ onUnhandledFrame: "bypass" });
}
