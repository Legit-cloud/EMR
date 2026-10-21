import { mkdirSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { apiPost, authFile, emailedCode, loadSeed, mailIdsFor } from "./helpers";

/**
 * Sign each role in once through the real API (password, then the code emailed to the
 * account, read from Mailpit) and save the session. Tests share these sessions instead of
 * signing in again. The sign-in screen itself is tested separately.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL;
  const seed = loadSeed();
  mkdirSync(path.join(__dirname, ".auth"), { recursive: true });
  for (const role of [
    "doctor",
    "desk",
    "billing",
    "pharmacist",
    "admin",
    "hr",
    "compliance",
  ] as const) {
    const user = seed.users[role];
    const context = await request.newContext({ baseURL });
    await context.get("/api/accounts/auth/csrf/");
    const credentials = { username: user.username, password: seed.password, mode: "session" };
    const before = await mailIdsFor(user.email);
    await apiPost(context, "/api/accounts/auth/login/", credentials); // emails the code
    const response = await apiPost(context, "/api/accounts/auth/login/", {
      ...credentials,
      otp_token: await emailedCode(user.email, before),
    });
    if (!response.ok()) {
      throw new Error(`Sign-in for ${role} failed: ${response.status()} ${await response.text()}`);
    }
    await context.storageState({ path: authFile(role) });
    await context.dispose();
  }
}
