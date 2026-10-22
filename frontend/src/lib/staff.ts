import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, type Schemas, unwrap } from "@/lib/api";
import { formatDay } from "@/lib/format";
import { LICENCE_FLAG, type StatusSpec } from "@/lib/status-map";

export type StaffProfile = Schemas["StaffProfile"];
export type StaffSummary = Schemas["StaffSummary"];
export type StaffGroup = "doctors" | "general";

export const STAFF_TYPE_LABEL: Record<StaffProfile["staff_type"], string> = {
  physician: "Physician",
  nurse: "Nurse / midwife",
  pharmacist: "Pharmacist",
  lab_scientist: "Lab scientist",
  radiographer: "Radiographer",
  other_clinical: "Other clinical",
  non_clinical: "Non-clinical",
};

/** The licence chip: the watcher's state, with the expiry date in the label. */
export function licenceChip(
  profile: Pick<StaffProfile, "licence_flag" | "licence_expires_on">,
): StatusSpec | null {
  if (!profile.licence_expires_on) return null;
  const base = LICENCE_FLAG[profile.licence_flag];
  const date = formatDay(profile.licence_expires_on);
  const label =
    profile.licence_flag === "expired"
      ? `Expired ${date}`
      : profile.licence_flag === "expiring"
        ? `Expires ${date}`
        : `Valid to ${date}`;
  return { ...base, label };
}

/** Second line under the name: the specialty for doctors, the role for everyone else. */
export function roleLine(profile: StaffProfile): string {
  return profile.specialty || STAFF_TYPE_LABEL[profile.staff_type];
}

export type StaffFilters = { group: StaffGroup; q: string; page: number; pageSize: number };

export function useStaffList({ group, q, page, pageSize }: StaffFilters) {
  return useQuery({
    queryKey: ["staff", "list", { group, q, page, pageSize }],
    queryFn: () =>
      unwrap(
        api.GET("/api/staff/profiles/", {
          params: { query: { group, q: q || undefined, page, page_size: String(pageSize) } },
        }),
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useStaffSummary() {
  return useQuery({
    queryKey: ["staff", "summary"],
    queryFn: () => unwrap(api.GET("/api/staff/profiles/summary/")),
    retry: false,
  });
}
