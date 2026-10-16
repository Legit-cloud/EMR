import { mkdirSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { apiPost, authFile, loadSeed, totp } from "./helpers";

/**
 * Sign each role in once through the real API (password + TOTP) and save the session.
 * django-otp refuses to reuse a code inside its 30-second window, so tests share these
 * sessions instead of signing in again. The sign-in screen itself is tested separately.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL;
  const seed = loadSeed();
  mkdirSync(path.join(__dirname, ".auth"), { recursive: true });
  for (const role of ["doctor", "desk", "billing"] as const) {
    const user = seed.users[role];
    const context = await request.newContext({ baseURL });
    await context.get("/api/accounts/auth/csrf/");
    const response = await apiPost(context, "/api/accounts/auth/login/", {
      username: user.username,
      password: seed.password,
      otp_token: totp(user.totp_key),
      mode: "session",
    });
    if (!response.ok()) {
      throw new Error(`Sign-in for ${role} failed: ${response.status()} ${await response.text()}`);
    }
    await context.storageState({ path: authFile(role) });
    await context.dispose();
  }
}
