import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Schemas, unwrap } from "@/lib/api";
import { refusalMessage } from "@/lib/stock";

/**
 * Staff-to-staff messages from apps/messaging, docs/adr/0026. Work talk only: never the clinical
 * record. A person sees just the threads they belong to, and the email alert never repeats
 * what was written.
 */
export type Thread = Schemas["Thread"];
export type ThreadDetail = Schemas["ThreadDetail"];
export type Message = Schemas["Message"];

export { refusalMessage };

/** The first line of a message for the thread list, cut at a word. */
export function preview(body: string | null, max = 80): string {
    const text = (body ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20))}…`;
}

/** The people in a thread other than the viewer, as "Ada, Bola and 2 others". */
export function memberLine(members: readonly string[], me: string): string {
    const others = members.filter((name) => name !== me);
    if (others.length <= 2) return others.join(" and ");
    return `${others[0]}, ${others[1]} and ${others.length - 2} ${others.length === 3 ? "other" : "others"}`;
}

export function useThreads() {
    return useQuery({
        queryKey: ["messages", "threads"],
        queryFn: () => unwrap(api.GET("/api/messaging/threads/")),
        // New messages arrive by polling; email tells people when they are away.
        refetchInterval: 30_000,
        retry: false,
    });
}

export function useThread(id: string | null) {
    return useQuery({
        queryKey: ["messages", "thread", id],
        queryFn: () =>
            unwrap(api.GET("/api/messaging/threads/{id}/", { params: { path: { id: id! } } })),
        enabled: id !== null,
        retry: false,
    });
}

export function usePeople(q: string) {
    return useQuery({
        queryKey: ["messages", "people", q],
        queryFn: () =>
            unwrap(
                api.GET("/api/staff/profiles/", {
                    params: { query: { q: q || undefined, page_size: "20" } },
                }),
            ),
        retry: false,
    });
}

function useRefresh() {
    const client = useQueryClient();
    return () => client.invalidateQueries({ queryKey: ["messages"] });
}

export function useStartThread() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (body: Schemas["NewThreadRequest"]) =>
            unwrap(api.POST("/api/messaging/threads/", { body })),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}

export function useReply(id: string) {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (body: string) =>
            unwrap(
                api.POST("/api/messaging/threads/{id}/reply/", {
                    params: { path: { id } },
                    body: { body },
                }),
            ),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}
