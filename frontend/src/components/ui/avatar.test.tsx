import { describe, expect, it } from "vitest";

import { avatarColour, initials } from "./avatar";

describe("initials", () => {
  it("takes the first and last name", () => {
    expect(initials("Ada Tester")).toBe("AT");
    expect(initials("Ngozi Ada Eze")).toBe("NE");
  });

  it("copes with one name or none", () => {
    expect(initials("ada")).toBe("AD");
    expect(initials("  ")).toBe("?");
  });
});

describe("avatarColour", () => {
  it("gives the same name the same colour", () => {
    expect(avatarColour("Ada Tester")).toBe(avatarColour("Ada Tester"));
  });

  it("uses the tint and text-safe pairs only", () => {
    for (const name of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      expect(avatarColour(name)).toMatch(/^bg-[a-z0-9-]+ text-[a-z0-9-]+$/);
    }
  });
});
