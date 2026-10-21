import { describe, expect, it } from "vitest";

import { activeItem, NAV, roleLabel, visibleNav, visibleQuickCreate } from "./nav-config";

const labels = (roles: string[]) =>
  visibleNav(roles).flatMap((group) => group.items.map((item) => item.label));

describe("visibleNav", () => {
  it("shows a user without roles only the dashboard", () => {
    expect(visibleNav([])).toEqual([NAV[0]]);
  });

  it("shows a front desk clerk the clinic screens and invoices, not pharmacy or admin", () => {
    const seen = labels(["front_desk"]);
    expect(seen).toEqual(
      expect.arrayContaining(["Appointments", "Queue", "Patients", "Duplicate review", "Invoices"]),
    );
    expect(seen).not.toContain("Pharmacy");
    expect(seen).not.toContain("Users and roles");
    expect(seen).not.toContain("Audit log");
  });

  it("shows a compliance officer the admin group only", () => {
    const groups = visibleNav(["compliance_officer"]);
    expect(groups.map((g) => g.caption)).toEqual([null, "Admin"]);
    expect(labels(["compliance_officer"])).toEqual([
      "Dashboard",
      "Break-glass review",
      "Audit log",
    ]);
  });

  it("shows a tenant admin every oversight screen, but not dispensing (SEC-02)", () => {
    expect(labels(["tenant_admin"])).toEqual([
      "Dashboard",
      "Appointments",
      "Queue",
      "Patients",
      "Duplicate review",
      "Staff list",
      "Invoices",
      "Insurers",
      "Stock",
      "Formulary",
      "Users and roles",
      "Break-glass review",
      "Audit log",
    ]);
  });

  it("combines the screens of every role a user holds", () => {
    const seen = labels(["pharmacist", "hr"]);
    expect(seen).toEqual(expect.arrayContaining(["Pharmacy", "Stock", "Formulary", "Staff list"]));
  });

  it("drops groups with nothing visible", () => {
    expect(visibleNav(["pharmacist"]).map((g) => g.caption)).not.toContain("Finance");
  });
});

describe("visibleQuickCreate", () => {
  it("offers new patient and appointment to the front desk", () => {
    expect(visibleQuickCreate(["front_desk"]).map((i) => i.label)).toEqual([
      "New patient",
      "New appointment",
    ]);
  });

  it("offers nothing to a compliance officer", () => {
    expect(visibleQuickCreate(["compliance_officer"])).toEqual([]);
  });
});

describe("activeItem", () => {
  it("matches a section and its sub-pages", () => {
    expect(activeItem("/patients")?.label).toBe("Patients");
    expect(activeItem("/patients/0b7a8000-0000-4000-8000-000000000000")?.label).toBe("Patients");
  });

  it("prefers the longest match", () => {
    expect(activeItem("/pharmacy/formulary")?.label).toBe("Formulary");
    expect(activeItem("/pharmacy")?.label).toBe("Pharmacy");
    expect(activeItem("/staff")?.label).toBe("Staff list");
    expect(activeItem("/manage/staff")?.label).toBe("Users and roles");
  });

  it("does not match a path that only shares a prefix", () => {
    expect(activeItem("/patientsx")).toBeNull();
  });
});

describe("roleLabel", () => {
  it("names the first known role", () => {
    expect(roleLabel(["doctor", "nurse"])).toBe("Doctor");
    expect(roleLabel(["tenant_admin"])).toBe("Tenant admin");
    expect(roleLabel([])).toBe("Staff");
  });
});
