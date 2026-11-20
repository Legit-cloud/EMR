import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Schemas, unwrap } from "@/lib/api";
import { toMinor } from "@/lib/money";
import { refusalMessage } from "@/lib/stock";

/**
 * General supplies (gloves, syringes, linen) from apps/inventory, docs/adr/0026. Drugs stay on
 * the pharmacy stock screen. The count changes only through movements: received, issued, or a
 * count correction with a reason.
 */
export type SupplyItem = Schemas["Item"];
export type SupplySummary = Schemas["Summary"];
export type Movement = Schemas["Movement"];
export type MovementKind = Schemas["MovementKindEnum"];

export { refusalMessage };

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
    receive: "Received",
    issue: "Issued",
    adjust: "Count correction",
};

/** Words for the stock level of a supply. */
export function levelOf(item: Pick<SupplyItem, "on_hand" | "reorder_level">): "out" | "low" | "ok" {
    if (item.on_hand === 0) return "out";
    return item.on_hand <= (item.reorder_level ?? 0) ? "low" : "ok";
}

/** A whole number of units from 0 to a million, or an error sentence. */
export function checkUnits(
    text: string,
    options: { min: number } = { min: 1 },
): { units: number } | { error: string } {
    const clean = text.trim();
    if (!/^\d+$/.test(clean)) return { error: "Enter a whole number, such as 12." };
    const units = Number(clean);
    if (units < options.min) {
        return { error: options.min === 0 ? "Enter zero or more." : "Enter at least 1." };
    }
    if (units > 1_000_000) return { error: "That is more than can be entered at once." };
    return { units };
}

/** What a movement will do to the stock, for the line under the form. */
export function afterMovement(kind: MovementKind, onHand: number, units: number): number {
    if (kind === "receive") return onHand + units;
    if (kind === "issue") return onHand - units;
    return units;
}

export function checkUnitCost(text: string, currency: string): number | null {
    if (text.trim() === "") return 0;
    return toMinor(text, currency);
}

export type SupplyFilters = { q: string; low: boolean; page: number };

export function useSupplies({ q, low, page }: SupplyFilters) {
    return useQuery({
        queryKey: ["inventory", "items", { q, low, page }],
        queryFn: () =>
            unwrap(
                api.GET("/api/inventory/items/", {
                    params: {
                        query: { search: q || undefined, status: low ? "low" : undefined, page },
                    },
                }),
            ),
        placeholderData: keepPreviousData,
        retry: false,
    });
}

export function useSupplySummary() {
    return useQuery({
        queryKey: ["inventory", "summary"],
        queryFn: () => unwrap(api.GET("/api/inventory/items/summary/")),
        retry: false,
    });
}

export function useMovements(item: string | null) {
    return useQuery({
        queryKey: ["inventory", "movements", item],
        queryFn: () =>
            unwrap(api.GET("/api/inventory/movements/", { params: { query: { item: item! } } })),
        enabled: item !== null,
        retry: false,
    });
}

function useRefresh() {
    const client = useQueryClient();
    return () => client.invalidateQueries({ queryKey: ["inventory"] });
}

export function useCreateSupply() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (body: Schemas["ItemRequest"]) =>
            unwrap(api.POST("/api/inventory/items/", { body })),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}

export function useMoveStock() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (body: Schemas["MovementRequestRequest"]) =>
            unwrap(api.POST("/api/inventory/movements/", { body })),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}
