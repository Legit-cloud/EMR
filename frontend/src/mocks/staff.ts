import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

import { mockSignedIn } from "./auth";

/**
 * Staff profiles, shaped like apps/staff: a directory split into doctors and everyone else, a
 * shift status, and a licence state set by the daily watcher. Synthetic data.
 */
type Profile = Schemas["StaffProfile"];

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let n = 0;
function person(
  name: string,
  staff_type: Profile["staff_type"],
  options: {
    title?: string;
    specialty?: string;
    onDuty?: boolean;
    expiresInDays?: number;
    flag?: Profile["licence_flag"];
  } = {},
): Profile {
  n += 1;
  const clinical = staff_type !== "non_clinical";
  return {
    id: `staff-${n}`,
    user: `user-${n}`,
    display_name: `${options.title ? `${options.title} ` : ""}${name}`,
    staff_type,
    title: options.title ?? "",
    specialty: options.specialty ?? "",
    licensing_body: !clinical ? "" : staff_type === "physician" ? "mdcn" : "nmcn",
    licence_number: clinical ? `LIC-${1000 + n}` : "",
    licence_expires_on: clinical ? inDays(options.expiresInDays ?? 400) : null,
    licence_verification: "verified",
    licence_verified_at: null,
    licence_verification_reference: "",
    licence_flag: options.flag ?? "ok",
    consultation_fee_minor: 0,
    consultation_fee_currency: "NGN",
    on_duty: options.onDuty ?? false,
  };
}

function seeded(): Profile[] {
  n = 0;
  return [
    person("Ada Okafor", "physician", { title: "Dr", specialty: "Cardiology", onDuty: true }),
    person("Bola Adeyemi", "physician", {
      title: "Dr",
      specialty: "Paediatrics",
      expiresInDays: 20,
      flag: "expiring",
    }),
    person("Chidi Eze", "physician", {
      title: "Dr",
      specialty: "General practice",
      expiresInDays: -12,
      flag: "expired",
    }),
    person("Amaka Obi", "nurse", { onDuty: true }),
    person("Tunde Bello", "pharmacist"),
    person("Ngozi Lawal", "non_clinical"),
  ];
}

export const staffMock = { profiles: seeded(), forbidden: false };

export function resetStaffMocks(): void {
  staffMock.profiles = seeded();
  staffMock.forbidden = false;
}

function failure(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, details: {} } }, { status });
}

function refusal() {
  const me = mockSignedIn();
  if (!me) return failure(401, "not_authenticated", "Not signed in.");
  return staffMock.forbidden
    ? failure(403, "permission_denied", "You do not have permission.")
    : null;
}

const isDoctor = (p: Profile) => p.staff_type === "physician";

export const staffHandlers = [
  http.get("*/api/staff/profiles/summary/", () => {
    const refused = refusal();
    if (refused) return refused;
    const all = staffMock.profiles;
    return HttpResponse.json({
      doctors: all.filter(isDoctor).length,
      general: all.filter((p) => !isDoctor(p)).length,
      licences_expiring: all.filter((p) => p.licence_flag === "expiring").length,
      licences_expired: all.filter((p) => p.licence_flag === "expired").length,
    } satisfies Schemas["StaffSummary"]);
  }),

  http.get("*/api/staff/profiles/", ({ request }) => {
    const refused = refusal();
    if (refused) return refused;
    const url = new URL(request.url);
    const group = url.searchParams.get("group");
    const staffType = url.searchParams.get("staff_type");
    const words = (url.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const found = staffMock.profiles
      .filter((p) =>
        group === "doctors" ? isDoctor(p) : group === "general" ? !isDoctor(p) : true,
      )
      .filter((p) => !staffType || p.staff_type === staffType)
      .filter((p) =>
        words.every((w) =>
          `${p.display_name} ${p.specialty} ${p.licence_number}`.toLowerCase().includes(w),
        ),
      );
    const size = Number(url.searchParams.get("page_size") ?? 50);
    const page = Number(url.searchParams.get("page") ?? 1);
    return HttpResponse.json({
      count: found.length,
      next: null,
      previous: null,
      results: found.slice((page - 1) * size, page * size),
    });
  }),
];
