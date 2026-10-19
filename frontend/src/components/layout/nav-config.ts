/**
 * The staff app navigation (docs/DESIGN.md Section 8). Roles mirror the API's view grants
 * so people see the screens they can use. Hiding is a convenience only: the API decides
 * access, and every screen handles a refusal.
 *
 * Only screens that exist are listed. Inpatient, claims, accounts, stock purchasing,
 * reports and support arrive with their screens.
 */
import {
  BookOpen,
  CalendarBlank,
  ClipboardText,
  type Icon,
  IdentificationCard,
  ListNumbers,
  Pill,
  Receipt,
  ShieldCheck,
  ShieldWarning,
  SquaresFour,
  UserGear,
  UserList,
  UsersThree,
} from "@phosphor-icons/react";

import type { Schemas } from "@/lib/api";

export type Role = Schemas["RoleEnum"];

export type NavItem = {
  label: string;
  href: string;
  icon: Icon;
  /** Roles that see the item; omitted means every signed-in user. */
  roles?: Role[];
};

export type NavGroup = { caption: string | null; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    caption: null,
    items: [{ label: "Dashboard", href: "/dashboard", icon: SquaresFour }],
  },
  {
    caption: "Clinic",
    items: [
      {
        label: "Appointments",
        href: "/schedule",
        icon: CalendarBlank,
        roles: ["front_desk", "tenant_admin", "doctor", "nurse"],
      },
      {
        label: "Queue",
        href: "/queue",
        icon: ListNumbers,
        roles: ["doctor", "nurse", "front_desk", "tenant_admin"],
      },
      {
        label: "Patients",
        href: "/patients",
        icon: UserList,
        roles: [
          "doctor",
          "nurse",
          "pharmacist",
          "lab_technician",
          "front_desk",
          "billing_officer",
          "tenant_admin",
        ],
      },
      {
        label: "Duplicate review",
        href: "/registrations",
        icon: UsersThree,
        roles: ["front_desk", "doctor", "tenant_admin"],
      },
      {
        label: "Staff list",
        href: "/manage/staff",
        icon: IdentificationCard,
        roles: ["hr", "tenant_admin"],
      },
    ],
  },
  {
    caption: "Finance",
    items: [
      {
        label: "Invoices",
        href: "/billing",
        icon: Receipt,
        roles: ["billing_officer", "finance", "front_desk", "tenant_admin"],
      },
      {
        label: "Insurers",
        href: "/billing/insurers",
        icon: ShieldCheck,
        roles: ["billing_officer", "tenant_admin", "front_desk", "finance"],
      },
    ],
  },
  {
    caption: "Physical asset",
    items: [
      { label: "Pharmacy", href: "/pharmacy", icon: Pill, roles: ["pharmacist"] },
      {
        label: "Formulary",
        href: "/pharmacy/formulary",
        icon: BookOpen,
        roles: ["pharmacist", "doctor", "nurse", "tenant_admin"],
      },
    ],
  },
  {
    caption: "Admin",
    items: [
      { label: "Users and roles", href: "/manage", icon: UserGear, roles: ["tenant_admin", "hr"] },
      {
        label: "Break-glass review",
        href: "/compliance",
        icon: ShieldWarning,
        roles: ["compliance_officer", "tenant_admin"],
      },
      {
        label: "Audit log",
        href: "/compliance/audit",
        icon: ClipboardText,
        roles: ["compliance_officer", "tenant_admin"],
      },
    ],
  },
];

export type QuickCreateItem = { label: string; href: string; roles: Role[] };

/** The round + button's menu: only actions that have a screen. */
export const QUICK_CREATE: QuickCreateItem[] = [
  { label: "New patient", href: "/patients/new", roles: ["doctor", "nurse", "front_desk"] },
  { label: "New appointment", href: "/schedule", roles: ["front_desk", "tenant_admin"] },
];

function allowed(roles: readonly string[], item: { roles?: Role[] }): boolean {
  return !item.roles || item.roles.some((role) => roles.includes(role));
}

/** The groups and items a user with these roles sees; empty groups are dropped. */
export function visibleNav(roles: readonly string[], nav: NavGroup[] = NAV): NavGroup[] {
  return nav
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed(roles, item)) }))
    .filter((group) => group.items.length > 0);
}

export function visibleQuickCreate(roles: readonly string[]): QuickCreateItem[] {
  return QUICK_CREATE.filter((item) => allowed(roles, item));
}

/** The item for a path: the longest href that matches, so /pharmacy/formulary beats /pharmacy. */
export function activeItem(pathname: string, nav: NavGroup[] = NAV): NavItem | null {
  let best: NavItem | null = null;
  for (const item of nav.flatMap((group) => group.items)) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

const ROLE_LABELS: Record<Role, string> = {
  tenant_admin: "Tenant admin",
  doctor: "Doctor",
  nurse: "Nurse",
  pharmacist: "Pharmacist",
  lab_technician: "Lab technician",
  front_desk: "Front desk",
  billing_officer: "Billing officer",
  finance: "Finance",
  hr: "HR",
  compliance_officer: "Compliance officer",
  patient: "Patient",
};

export function roleLabel(roles: readonly string[]): string {
  const first = roles.find((role): role is Role => role in ROLE_LABELS);
  return first ? ROLE_LABELS[first] : "Staff";
}
