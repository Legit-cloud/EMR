"use client";

import { useMemo } from "react";

import type { Schemas } from "./api";
import { useMe } from "./session";

export type Role = Schemas["RoleEnum"];
export type Me = Schemas["Me"];

export type Permissions = {
  roles: ReadonlySet<string>;
  /** True when the user holds any of the roles. */
  hasRole: (...roles: Role[]) => boolean;
  /** Whether a role assignment covers the facility (an assignment without one covers all). */
  inFacility: (facilityId: string, ...roles: Role[]) => boolean;
  /** Whether a role assignment covers the department, directly or through its facility. */
  inDepartment: (departmentId: string, facilityId: string, ...roles: Role[]) => boolean;
  onDuty: boolean;
  canBreakGlass: boolean;
};

/**
 * Reads the user's roles and attributes from /auth/me. Use it only to hide navigation and
 * buttons someone could not use anyway. It is never the security boundary: the API checks
 * every request, and every screen still handles a refusal.
 */
export function permissionsFor(me: Me): Permissions {
  const roles = new Set<string>(me.roles);
  const matching = (wanted: Role[]) =>
    me.assignments.filter((a) => wanted.length === 0 || wanted.includes(a.role as Role));
  return {
    roles,
    hasRole: (...wanted) => wanted.some((role) => roles.has(role)),
    inFacility: (facilityId, ...wanted) =>
      matching(wanted).some((a) => a.facility === null || a.facility === facilityId),
    inDepartment: (departmentId, facilityId, ...wanted) =>
      matching(wanted).some((a) =>
        a.department !== null
          ? a.department === departmentId
          : a.facility === null || a.facility === facilityId,
      ),
    onDuty: me.on_duty,
    canBreakGlass: me.can_break_glass,
  };
}

export function usePermissions(): Permissions {
  const me = useMe();
  return useMemo(() => permissionsFor(me), [me]);
}
