import type { NextConfig } from "next";

const config: NextConfig = {
  // The API is reached on the same origin (/api, /ws) through the edge proxy, so the
  // browser never needs CORS and session cookies stay first-party.
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
