import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, type Schemas, unwrap } from "@/lib/api";
import { formatMoney, toMinor } from "@/lib/money";

/**
 * The patient portal, from apps/portal (docs/adr/0022). Every call is for the signed-in patient
 * and nobody else: the server takes the patient from the session, and there is no patient id
 * anywhere in these requests.
 */
export type PortalAppointment = Schemas["PortalAppointment"];
export type PortalSlot = Schemas["PortalSlot"];
export type PortalResult = Schemas["PortalResult"];
export type PortalPrescription = Schemas["PortalPrescription"];
export type PortalInvoice = Schemas["PortalInvoice"];
export type PortalProfile = Schemas["PortalProfile"];
export type PortalHome = Schemas["PortalHome"];
// -- queries -----------------------------------------------------------------------------------

export const useHome = () =>
  useQuery({
    queryKey: ["portal", "home"],
    queryFn: () => unwrap(api.GET("/api/portal/home/")),
    retry: false,
  });

export const useAppointments = () =>
  useQuery({
    queryKey: ["portal", "appointments"],
    queryFn: () => unwrap(api.GET("/api/portal/appointments/")),
    retry: false,
  });

export const useSlots = (enabled: boolean) =>
  useQuery({
    queryKey: ["portal", "slots"],
    queryFn: () => unwrap(api.GET("/api/portal/appointment-slots/")),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  });

export const useResults = () =>
  useQuery({
    queryKey: ["portal", "results"],
    queryFn: () => unwrap(api.GET("/api/portal/results/")),
    retry: false,
  });

export const usePrescriptions = () =>
  useQuery({
    queryKey: ["portal", "prescriptions"],
    queryFn: () => unwrap(api.GET("/api/portal/prescriptions/")),
    retry: false,
  });

export const useInvoices = () =>
  useQuery({
    queryKey: ["portal", "invoices"],
    queryFn: () => unwrap(api.GET("/api/portal/invoices/")),
    retry: false,
  });

export const useProfile = () =>
  useQuery({
    queryKey: ["portal", "profile"],
    queryFn: () => unwrap(api.GET("/api/portal/profile/")),
    retry: false,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["portal"] });
}

export function useBook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["BookRequest"]) =>
      unwrap(api.POST("/api/portal/appointments/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useCancel(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["PortalCancelRequest"]) =>
      unwrap(api.POST("/api/portal/appointments/{id}/cancel/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useMarkSeen() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/portal/results/{id}/seen/", { params: { path: { id } } })),
    onSettled: () => refresh(),
  });
}

export function useSaveProfile() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["PatchedProfileUpdateRequest"]) =>
      unwrap(api.PATCH("/api/portal/profile/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export const refusalMessage = (failure: unknown) => apiError(failure).message;

// -- small rules -------------------------------------------------------------------------------

/** Results the patient has not opened yet. */
export const unseen = (results: readonly PortalResult[]) => results.filter((r) => !r.seen);

// -- paying a bill online (Paystack, docs/adr/0023) --------------------------------------------

/** What the patient typed, as a payment: any amount up to what they owe, in whole kobo. */
export function checkPaymentAmount(
  text: string,
  due: number,
  currency: string,
): { minor: number } | { error: string } {
  const minor = toMinor(text, currency);
  if (minor === null) return { error: "Enter an amount such as 1500.00." };
  if (minor < 1) return { error: "The amount must be more than zero." };
  if (minor > due) return { error: `You owe ${formatMoney(due, currency)} on this bill.` };
  return { minor };
}

export function usePayOnline(invoice: string) {
  return useMutation({
    mutationFn: (body: Schemas["PayRequestRequest"]) =>
      unwrap(
        api.POST("/api/portal/invoices/{id}/pay/", { params: { path: { id: invoice } }, body }),
      ),
    meta: { quietErrors: true },
  });
}

/** Ask the server what happened to a payment, when the patient comes back from the payment page. */
export function useVerifyPayment() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reference: string) =>
      unwrap(
        api.POST("/api/portal/payments/{reference}/verify/", { params: { path: { reference } } }),
      ),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** The sentence shown to the patient for each outcome. */
export const PAYMENT_OUTCOME: Record<
  Schemas["PaymentResultStatusEnum"],
  { tone: "info" | "danger" | "warning"; title: string }
> = {
  succeeded: { tone: "info", title: "Payment received. Thank you." },
  pending: {
    tone: "info",
    title:
      "We have not been told about your payment yet. If you have paid, it will show here shortly.",
  },
  failed: { tone: "danger", title: "The payment did not go through. You have not been charged." },
  review: {
    tone: "warning",
    title:
      "We received your payment and are checking it. The billing office will contact you if anything is needed.",
  },
};

// -- data protection: the patient's rights and the privacy notice (docs/adr/0024) --------------

export type PortalRequest = Schemas["PortalRequest"];
export type RequestKind = Schemas["DataRequestKindEnum"];
export type PrivacyNotice = Schemas["PrivacyNotice"];

/** What a patient can ask for, in the words they would use. */
export const REQUEST_KINDS: {
  value: RequestKind;
  label: string;
  needsDetails: boolean;
  help: string;
}[] = [
  {
    value: "access",
    label: "A copy of my records",
    needsDetails: false,
    help: "We will give you a copy of the information we hold about you.",
  },
  {
    value: "correction",
    label: "Correct something that is wrong",
    needsDetails: true,
    help: "Tell us what is wrong and what it should say.",
  },
  {
    value: "erasure",
    label: "Delete my information",
    needsDetails: false,
    help: "We keep medical records for the time the law requires, so we may not be able to delete everything. We will tell you what we can do and why.",
  },
  {
    value: "restriction",
    label: "Limit how my information is used",
    needsDetails: true,
    help: "Tell us what you would like us to stop doing.",
  },
  {
    value: "objection",
    label: "I object to how my information is used",
    needsDetails: true,
    help: "Tell us what you object to and why.",
  },
  {
    value: "portability",
    label: "Move my information to another provider",
    needsDetails: false,
    help: "We will give you your information in a form you can pass on.",
  },
];

export const useRequests = () =>
  useQuery({
    queryKey: ["portal", "requests"],
    queryFn: () => unwrap(api.GET("/api/portal/requests/")),
    retry: false,
  });

export const usePrivacyNotice = () =>
  useQuery({
    queryKey: ["portal", "privacy"],
    queryFn: () => unwrap(api.GET("/api/portal/privacy/")),
    retry: false,
    staleTime: 10 * 60_000,
  });

export function useSubmitRequest() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Schemas["RequestCreateRequest"]) =>
      unwrap(api.POST("/api/portal/requests/", { body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** Save everything the portal holds about the patient as a file on their device. */
export async function downloadMyInformation(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  const response = await globalThis.fetch(`${base}/api/portal/my-information/`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Your information could not be downloaded.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "my-information.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
