import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Schemas, unwrap } from "@/lib/api";
import { refusalMessage } from "@/lib/stock";

/** Staff leave from apps/staff, docs/adr/0026. HR decides; nobody decides their own. */
export type Leave = Schemas["Leave"];
export type LeaveStatus = Schemas["LeaveStatusEnum"];
export type LeaveType = Schemas["LeaveTypeEnum"];

export { refusalMessage };

export const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
    { value: "annual", label: "Annual leave" },
    { value: "sick", label: "Sick leave" },
    { value: "maternity", label: "Maternity leave" },
    { value: "paternity", label: "Paternity leave" },
    { value: "study", label: "Study leave" },
    { value: "unpaid", label: "Unpaid leave" },
];

export const leaveTypeLabel = (type: LeaveType) =>
    LEAVE_TYPES.find((t) => t.value === type)?.label ?? type;

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "12 Dec 2026 to 14 Dec 2026 (3 days)". Dates are plain calendar days, not moments. */
export function leaveRange(leave: Pick<Leave, "start_date" | "end_date" | "days">): string {
    const fmt = (iso: string) => day.format(new Date(`${iso}T12:00:00`));
    const days = `${leave.days} ${leave.days === 1 ? "day" : "days"}`;
    return leave.start_date === leave.end_date
        ? `${fmt(leave.start_date)} (${days})`
        : `${fmt(leave.start_date)} to ${fmt(leave.end_date)} (${days})`;
}

/** The problem with a request's dates, or null. `today` is YYYY-MM-DD. */
export function checkLeaveDates(start: string, end: string, today: string): string | null {
    if (!start || !end) return "Choose the first and last day.";
    if (start < today) return "Leave cannot start in the past.";
    if (end < start) return "The last day cannot be before the first day.";
    return null;
}

/** Whether the requester may still withdraw it. */
export const canCancel = (leave: Pick<Leave, "status" | "start_date">, today: string) =>
    leave.status === "pending" || (leave.status === "approved" && leave.start_date > today);

export function useLeave({ status, page }: { status: string; page: number }) {
    return useQuery({
        queryKey: ["leave", { status, page }],
        queryFn: () =>
            unwrap(
                api.GET("/api/staff/leave/", {
                    params: { query: { status: status === "all" ? undefined : status, page } },
                }),
            ),
        placeholderData: keepPreviousData,
        retry: false,
    });
}

function useRefresh() {
    const client = useQueryClient();
    return () => client.invalidateQueries({ queryKey: ["leave"] });
}

export function useRequestLeave() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (body: Schemas["LeaveRequestRequest"]) =>
            unwrap(api.POST("/api/staff/leave/", { body })),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}

export function useDecideLeave() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) =>
            unwrap(
                api.POST("/api/staff/leave/{id}/decide/", {
                    params: { path: { id } },
                    body: { approve, note },
                }),
            ),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}

export function useCancelLeave() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (id: string) =>
            unwrap(api.POST("/api/staff/leave/{id}/cancel/", { params: { path: { id } } })),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}
