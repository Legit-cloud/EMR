import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The edge proxy (deploy/edge/nginx.conf) sends these first path segments to Django, not to the
 * web app. A page under one of them is unreachable in a real deployment; the audit log once
 * lived at /admin/audit and showed Django's admin login instead.
 */
const RESERVED = ["api", "admin", "static", "healthz"];

/** First segment of every route in src/app, ignoring route groups such as (app). */
function topSegments(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) return [];
    if (name.startsWith("(")) return topSegments(path);
    return [name];
  });
}

describe("routes and the edge proxy", () => {
  it("has no page under a prefix the proxy sends to Django", () => {
    const clashes = topSegments(join(process.cwd(), "src", "app")).filter((name) =>
      RESERVED.includes(name),
    );
    expect(clashes).toEqual([]);
  });

  it("keeps this list in step with the proxy configuration, where the file is visible", () => {
    const file = join(process.cwd(), "..", "deploy", "edge", "nginx.conf");
    // The tools container mounts only frontend/, so the proxy file is not always there.
    if (!existsSync(file)) return;
    const listed = /location ~ \^\/\(([^)]+)\)/.exec(readFileSync(file, "utf-8"))?.[1] ?? "";
    expect(listed.split("|").sort()).toEqual([...RESERVED].sort());
  });
});
