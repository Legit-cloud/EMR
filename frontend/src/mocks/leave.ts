import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

/** Leave requests, shaped like apps/staff (docs/adr/0026). Synthetic data. */
type Leave = Schemas["Leave"];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function seeded(): Mutable<Leave>[] {
  const make = (n: number, name: string, start: number, end: number, status: Leave["status"]) => ({
    id: `leave-${n}`,
    staff: `staff-${n}`,
    staff_name: name,
    leave_type: "annual" as const,
    start_date: inDays(start),
    end_date: inDays(end),
    days: end - start + 1,
    note: "",
    status,
    decided_at: null,
    decision_note: "",
  });
  return [make(1, "Amaka Obi", 10, 12, "pending"), make(2, "Bola Adeyemi", 20, 20, "approved")];
}

export let leaves = seeded();
export const resetLeaveMocks = () => {
  leaves = seeded();
};

const refuse = (message: string) =>
  HttpResponse.json({ error: { code: "leave_refused", message, details: {} } }, { status: 400 });

export const leaveHandlers = [
  http.get("*/api/staff/leave/", ({ request }) => {
    const status = new URL(request.url).searchParams.get("status");
    const rows = leaves.filter((l) => !status || l.status === status);
    return HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows });
  }),
  http.post("*/api/staff/leave/", async ({ request }) => {
    const body = (await request.json()) as Schemas["LeaveRequestRequest"];
    if (body.end_date < body.start_date)
      return refuse("The last day cannot be before the first day.");
    const leave: Mutable<Leave> = {
      id: `leave-${leaves.length + 1}`,
      staff: "staff-me",
      staff_name: "You",
      leave_type: body.leave_type,
      start_date: body.start_date,
      end_date: body.end_date,
      days: (Date.parse(body.end_date) - Date.parse(body.start_date)) / 86_400_000 + 1,
      note: body.note,
      status: "pending",
      decided_at: null,
      decision_note: "",
    };
    leaves.unshift(leave);
    return HttpResponse.json(leave, { status: 201 });
  }),
  http.post("*/api/staff/leave/:id/decide/", async ({ params, request }) => {
    const body = (await request.json()) as Schemas["LeaveDecisionRequest"];
    const leave = leaves.find((l) => l.id === params.id);
    if (!leave) return HttpResponse.json({}, { status: 404 });
    if (leave.status !== "pending") return refuse("This request is already decided.");
    if (!body.approve && !body.note.trim()) return refuse("Say why the request is being rejected.");
    leave.status = body.approve ? "approved" : "rejected";
    leave.decision_note = body.note;
    return HttpResponse.json(leave);
  }),
  http.post("*/api/staff/leave/:id/cancel/", ({ params }) => {
    const leave = leaves.find((l) => l.id === params.id);
    if (!leave) return HttpResponse.json({}, { status: 404 });
    leave.status = "cancelled";
    return HttpResponse.json(leave);
  }),
];
