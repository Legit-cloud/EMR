import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiError, type Schemas } from "@/lib/api";
import type { ResultFlag } from "@/lib/plain-language";
import { planned } from "@/lib/planned-api";

/**
 * The patient portal. Its backend is planned, so these types are the contract the screens are
 * built against (docs/adr/0020). Every call is for the signed-in patient and nobody else: the
 * server must derive the patient from the session, never from an id in the request.
 */
export type PortalAppointment = {
  id: string;
  doctor_name: string;
  specialty: string;
  location: string;
  start_at: string;
  end_at: string;
  status: Schemas["AppointmentStatusEnum"];
  reason: string;
  can_cancel: boolean;
};

export type PortalSlot = {
  id: string;
  doctor_name: string;
  specialty: string;
  start_at: string;
  end_at: string;
};

export type PortalResult = {
  id: string;
  kind: "lab" | "imaging";
  name: string;
  taken_at: string;
  ordered_by: string;
  seen: boolean;
  flag: ResultFlag;
  value: string;
  unit: string;
  low: number | null;
  high: number | null;
  /** Imaging reports and long lab comments, already written for the patient. */
  note: string;
};

export type PortalPrescription = {
  id: string;
  prescribed_at: string;
  doctor_name: string;
  active: boolean;
  items: {
    id: string;
    drug_name: string;
    dose: string;
    frequency: string;
    route: string;
    duration_days: number;
    quantity: number;
    instructions: string;
  }[];
};

export type PortalInvoice = {
  id: string;
  reference: string;
  created_at: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  status: Schemas["PaymentStatusEnum"];
  lines: { description: string; amount_minor: number }[];
};

export type ConsentKey = "sms_reminders" | "email_reminders" | "share_in_facility" | "research";

export type PortalProfile = {
  first_name: string;
  last_name: string;
  mrn: string;
  date_of_birth: string;
  phone: string;
  email: string;
  consents: Record<ConsentKey, boolean>;
};

export type PortalHome = {
  first_name: string;
  next_appointment: PortalAppointment | null;
  new_results: number;
  balance_minor: number;
  currency: string;
};

export const CONSENTS: { key: ConsentKey; label: string; explain: string }[] = [
  {
    key: "sms_reminders",
    label: "Text message reminders",
    explain: "We text you before an appointment and when a bill is due.",
  },
  {
    key: "email_reminders",
    label: "Email reminders",
    explain: "We email you the same reminders, with your appointment calendar file.",
  },
  {
    key: "share_in_facility",
    label: "Share my record with the clinicians treating me",
    explain:
      "Doctors and nurses involved in your care here can see your record. Turning this off may slow your care.",
  },
  {
    key: "research",
    label: "Use my details, with my name removed, to improve care",
    explain:
      "Your information is never used with your name attached. This is optional and does not change your care.",
  },
];

// -- queries -----------------------------------------------------------------------------------

const get = <T>(key: string[], path: string, extra: { enabled?: boolean } = {}) => ({
  queryKey: ["portal", ...key],
  queryFn: () => planned.get<T>(path),
  retry: false,
  ...extra,
});

export const useHome = () => useQuery(get<PortalHome>(["home"], "/api/portal/home/"));
export const useAppointments = () =>
  useQuery(get<PortalAppointment[]>(["appointments"], "/api/portal/appointments/"));
export const useSlots = (enabled: boolean) =>
  useQuery({
    ...get<PortalSlot[]>(["slots"], "/api/portal/appointment-slots/", { enabled }),
    placeholderData: keepPreviousData,
  });
export const useResults = () => useQuery(get<PortalResult[]>(["results"], "/api/portal/results/"));
export const usePrescriptions = () =>
  useQuery(get<PortalPrescription[]>(["prescriptions"], "/api/portal/prescriptions/"));
export const useInvoices = () =>
  useQuery(get<PortalInvoice[]>(["invoices"], "/api/portal/invoices/"));
export const useProfile = () => useQuery(get<PortalProfile>(["profile"], "/api/portal/profile/"));

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["portal"] });
}

export function useBook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { slot: string; reason: string }) =>
      planned.post<PortalAppointment>("/api/portal/appointments/", body),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useCancel(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { reason: string }) =>
      planned.post<PortalAppointment>(`/api/portal/appointments/${id}/cancel/`, body),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useMarkSeen() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => planned.post<PortalResult>(`/api/portal/results/${id}/seen/`),
    onSettled: () => refresh(),
  });
}

export function usePay(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { amount_minor: number; method: "card" | "transfer"; key: string }) =>
      planned.post<PortalInvoice>(`/api/portal/invoices/${id}/pay/`, body),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useSaveProfile() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Partial<Pick<PortalProfile, "phone" | "email" | "consents">>) =>
      planned.patch<PortalProfile>("/api/portal/profile/", body),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

// -- small rules -------------------------------------------------------------------------------

/** Results the patient has not opened yet. */
export const unseen = (results: readonly PortalResult[]) => results.filter((r) => !r.seen);

/** A payment: any amount up to what is due, in whole kobo. */
export function checkPayment(
  minor: number | null,
  due: number,
): { minor: number } | { error: string } {
  if (minor === null) return { error: "Enter an amount such as 1500.00." };
  if (minor < 1) return { error: "The amount must be more than zero." };
  if (minor > due) return { error: "That is more than you owe on this bill." };
  return { minor };
}
