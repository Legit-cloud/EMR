/**
 * The single mock switch. With NEXT_PUBLIC_USE_MOCKS=true the browser answers API
 * requests from src/mocks instead of the backend.
 *
 * Development only: a production build (`next build`) forces the switch off, so the compiler
 * drops the dynamic import below and nothing from src/mocks, including the msw library, is
 * bundled. The Dockerfile also removes the msw worker script from the production image.
 */
export const useMocks =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export async function startMocks(): Promise<void> {
  if (!useMocks || typeof window === "undefined") return;
  const { worker } = await import("@/mocks/browser");
  await worker.start({ onUnhandledFrame: "bypass" });
}
