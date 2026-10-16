import { describe, expect, it } from "vitest";

import { newIdempotencyKey } from "./ids";

describe("newIdempotencyKey", () => {
  it("makes RFC 4122 version 4 UUIDs", () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("does not repeat", () => {
    const keys = new Set(Array.from({ length: 200 }, newIdempotencyKey));
    expect(keys.size).toBe(200);
  });
});
