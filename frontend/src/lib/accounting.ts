import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Schemas, unwrap } from "@/lib/api";
import { toMinor } from "@/lib/money";
import { refusalMessage } from "@/lib/stock";

/**
 * Accounting from apps/billing, docs/adr/0026: the ledger's entries, manual entries finance
 * adds (expenses, supplier bills, opening balances) and reverses, and two reports. Entries are
 * never edited: a mistake is reversed. Every entry balances: debits equal credits.
 */
export type JournalEntry = Schemas["JournalEntry"];
export type IncomeStatement = Schemas["IncomeStatement"];
export type BalanceSheet = Schemas["BalanceSheet"];

export { refusalMessage };

/** Accounts finance can post to by hand. The server creates each on first use. */
export const MANUAL_ACCOUNTS = [
    { code: "1000", name: "Cash on hand" },
    { code: "1010", name: "Bank" },
    { code: "2000", name: "Accounts payable" },
    { code: "3000", name: "Owner's equity" },
    { code: "5100", name: "Salaries and wages" },
    { code: "5200", name: "Medical and general supplies" },
    { code: "5300", name: "Utilities and rent" },
    { code: "5900", name: "Other expenses" },
] as const;

export type DraftLine = { account: string; debit: string; credit: string };

export const emptyLine = (): DraftLine => ({ account: "", debit: "", credit: "" });

export type DraftCheck =
    { error: string } | { lines: { account: string; debit_minor: number; credit_minor: number }[] };

/** Totals of what is typed so far, ignoring blank or invalid amounts, for the running balance. */
export function draftTotals(lines: readonly DraftLine[], currency = "NGN") {
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
        debit += toMinor(line.debit || "0", currency) ?? 0;
        credit += toMinor(line.credit || "0", currency) ?? 0;
    }
    return { debit, credit, balanced: debit === credit && debit > 0 };
}

/** Each filled line is a debit or a credit, an account is chosen, and the entry balances. */
export function checkDraft(lines: readonly DraftLine[], currency = "NGN"): DraftCheck {
    const filled = lines.filter((l) => l.account || l.debit.trim() || l.credit.trim());
    if (filled.length < 2) return { error: "An entry needs at least two lines." };
    const out = [];
    for (const line of filled) {
        if (!line.account) return { error: "Choose an account on every line." };
        const debit = line.debit.trim() ? toMinor(line.debit, currency) : 0;
        const credit = line.credit.trim() ? toMinor(line.credit, currency) : 0;
        if (debit === null || credit === null) return { error: "Enter amounts such as 1500.00." };
        if (debit > 0 === credit > 0) {
            return { error: "Each line is either a debit or a credit, not both or neither." };
        }
        out.push({ account: line.account, debit_minor: debit, credit_minor: credit });
    }
    const totals = draftTotals(lines, currency);
    if (!totals.balanced) return { error: "Debits and credits must be equal." };
    return { lines: out };
}

/** Finance can undo only entries it added by hand; invoice entries are fixed on the invoice. */
export const canReverse = (entry: Pick<JournalEntry, "source">) => entry.source === "manual";

/** Which side of the entry a line is on, as a signed total for the Entries table. */
export function entryTotal(entry: JournalEntry): number {
    return entry.lines.reduce((sum, l) => sum + (l.debit_minor ?? 0), 0);
}

export function useEntries(page: number) {
    return useQuery({
        queryKey: ["accounting", "entries", page],
        queryFn: () =>
            unwrap(api.GET("/api/billing/ledger/entries/", { params: { query: { page } } })),
        retry: false,
    });
}

export function useIncomeStatement(start: string, end: string) {
    return useQuery({
        queryKey: ["accounting", "income", start, end],
        queryFn: () =>
            unwrap(
                api.GET("/api/billing/ledger/accounts/income-statement/", {
                    params: { query: { start, end } },
                }),
            ),
        retry: false,
    });
}

export function useBalanceSheet(asOf: string) {
    return useQuery({
        queryKey: ["accounting", "balance", asOf],
        queryFn: () =>
            unwrap(
                api.GET("/api/billing/ledger/accounts/balance-sheet/", {
                    params: { query: { as_of: asOf } },
                }),
            ),
        retry: false,
    });
}

function useRefresh() {
    const client = useQueryClient();
    return () => client.invalidateQueries({ queryKey: ["accounting"] });
}

export function usePostEntry() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: (body: Schemas["ManualEntryRequest"]) =>
            unwrap(api.POST("/api/billing/ledger/entries/", { body })),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}

export function useReverseEntry() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) =>
            unwrap(
                api.POST("/api/billing/ledger/entries/{id}/reverse/", {
                    params: { path: { id } },
                    body: { reason },
                }),
            ),
        onSettled: () => refresh(),
        meta: { quietErrors: true },
    });
}
