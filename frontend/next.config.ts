import type { NextConfig } from "next";

/**
 * Where the Django API lives when the web app is hosted apart from it (for example the web app
 * on Vercel and the API on Railway). Set API_ORIGIN to the API's address, such as
 * https://emr-production.up.railway.app, with no trailing slash. Unset, nothing is rewritten
 * and the edge proxy (docker compose, Enterprise installs) serves /api itself.
 */
const apiOrigin = process.env.API_ORIGIN?.replace(/\/+$/, "");

const config: NextConfig = {
  // The browser always calls /api on the web app's own address, so session and CSRF cookies stay
  // first-party and no CORS is needed. With API_ORIGIN set, Next forwards those calls to the API.
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return apiOrigin ? [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }] : [];
  },
};

export default config;
