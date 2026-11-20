"use client";

import { ArrowUUpLeft, Plus } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
    type BalanceSheet,
    canReverse,
    checkDraft,
    draftTotals,
    emptyLine,
    type DraftLine,
    entryTotal,
    type IncomeStatement,
    type JournalEntry,
    MANUAL_ACCOUNTS,
    refusalMessage,
    useBalanceSheet,
    useEntries,
    useIncomeStatement,
    usePostEntry,
    useReverseEntry,
} from "@/lib/accounting";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { usePermissions } from "@/lib/permissions";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

/** The books: entries, an income statement for a period and a balance sheet as at a date. */
export function AccountingScreen() {
    const entries = useEntries(1);
    if (entries.error instanceof ApiRequestError && entries.error.status === 403) {
        return <NoAccess what="accounting" asPage />;
    }
    return (
        <>
            <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <h1 className="text-page-title text-ink-900">Accounting</h1>
            </header>
            <Tabs
                label="Accounting"
                defaultValue="entries"
                items={[
                    { value: "entries", label: "Entries", content: <EntriesTab /> },
                    { value: "income", label: "Income statement", content: <IncomeTab /> },
                    { value: "balance", label: "Balance sheet", content: <BalanceTab /> },
                ]}
            />
        </>
    );
}

// -- entries -----------------------------------------------------------------------------------

function EntriesTab() {
    const permissions = usePermissions();
    const canPost = permissions.hasRole("finance");
    const [page, setPage] = useState(1);
    const list = useEntries(page);
    const [adding, setAdding] = useState(false);
    const [reversing, setReversing] = useState<JournalEntry | null>(null);

    const columns: Column<JournalEntry>[] = [
        {
            id: "when",
            header: "Posted",
            cell: (row) => <span className="text-ink-600">{formatDateTime(row.posted_at)}</span>,
        },
        {
            id: "description",
            header: "Description",
            cell: (row) => (
                <span className="flex min-w-0 flex-col">
                    <span className="text-ink-900 truncate font-semibold">{row.description}</span>
                    <span className="text-small text-ink-500">
                        {row.lines
                            .map((l) => `${l.account} ${l.debit_minor ? "Dr" : "Cr"}`)
                            .join(" · ")}
                    </span>
                </span>
            ),
        },
        {
            id: "source",
            header: "From",
            className: "hidden md:table-cell",
            cell: (row) => (
                <span className="text-ink-600">
                    {row.source === "manual" ? "Manual" : row.source}
                </span>
            ),
        },
        {
            id: "amount",
            header: "Amount",
            cell: (row) => (
                <span className="tnum">{formatMoney(entryTotal(row), row.currency)}</span>
            ),
        },
        {
            id: "reverse",
            header: "",
            cell: (row) =>
                canPost && canReverse(row) ? (
                    <Button
                        variant="ghost"
                        icon={ArrowUUpLeft}
                        aria-label={`Reverse ${row.description}`}
                        onClick={() => setReversing(row)}
                    >
                        Reverse
                    </Button>
                ) : null,
        },
    ];

    return (
        <section
            aria-label="Ledger entries"
            className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
        >
            <div className="flex flex-wrap items-center gap-3 p-4">
                <p className="text-small text-ink-600">
                    Entries are never edited. A mistake is reversed with a new entry.
                </p>
                {canPost && (
                    <Button icon={Plus} className="ml-auto" onClick={() => setAdding(true)}>
                        New entry
                    </Button>
                )}
            </div>
            <DataTable
                caption="Ledger entries"
                columns={columns}
                rows={list.data?.results}
                rowId={(row) => row.id}
                error={list.isError}
                onRetry={() => list.refetch()}
                pagination={{
                    page,
                    pageSize: 25,
                    total: list.data?.count ?? 0,
                    onPageChange: setPage,
                    onPageSizeChange: () => undefined,
                }}
                empty={<EmptyState title="No ledger entries yet." />}
            />
            <EntryDialog open={adding} onOpenChange={setAdding} />
            <ReverseDialog entry={reversing} onOpenChange={(open) => !open && setReversing(null)} />
        </section>
    );
}

function EntryDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title="New ledger entry"
            description="For expenses, supplier bills and opening balances. Debits must equal credits."
            size="wide"
            footer={
                <ModalFooter
                    start={
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                    }
                    end={
                        <Button type="submit" form="entry-form">
                            Post entry
                        </Button>
                    }
                />
            }
        >
            {open && <EntryForm onDone={() => onOpenChange(false)} />}
        </Modal>
    );
}

function EntryForm({ onDone }: { onDone: () => void }) {
    const toast = useToast();
    const post = usePostEntry();
    const [description, setDescription] = useState("");
    const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
    const [error, setError] = useState<string | null>(null);
    const totals = draftTotals(lines);

    const change = (index: number, patch: Partial<DraftLine>) => {
        setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
        setError(null);
    };

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!description.trim()) return setError("Describe what the entry is for.");
        const checked = checkDraft(lines);
        if ("error" in checked) return setError(checked.error);
        try {
            await post.mutateAsync({
                description: description.trim(),
                currency: "NGN",
                lines: checked.lines,
            });
            toast({ title: "Entry posted", tone: "success" });
            onDone();
        } catch (failure) {
            setError(refusalMessage(failure));
        }
    }

    return (
        <form id="entry-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
            {error && <Banner tone="danger" live title={error} />}
            <Input
                label="Description"
                value={description}
                maxLength={255}
                onChange={(e) => {
                    setDescription(e.target.value);
                    setError(null);
                }}
            />
            <ul className="flex flex-col gap-3">
                {lines.map((line, index) => (
                    <li
                        key={index}
                        aria-label={`Line ${index + 1}`}
                        className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]"
                    >
                        <Select
                            label={`Account, line ${index + 1}`}
                            options={MANUAL_ACCOUNTS.map((a) => ({
                                value: a.code,
                                label: `${a.code} ${a.name}`,
                            }))}
                            value={line.account || undefined}
                            placeholder="Choose an account"
                            onValueChange={(value) => change(index, { account: value })}
                        />
                        <Input
                            label={`Debit, line ${index + 1}`}
                            inputMode="decimal"
                            value={line.debit}
                            onChange={(e) => change(index, { debit: e.target.value, credit: "" })}
                        />
                        <Input
                            label={`Credit, line ${index + 1}`}
                            inputMode="decimal"
                            value={line.credit}
                            onChange={(e) => change(index, { credit: e.target.value, debit: "" })}
                        />
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                    variant="dashed"
                    icon={Plus}
                    onClick={() => setLines((c) => [...c, emptyLine()])}
                >
                    Add a line
                </Button>
                <p role="status" className="text-small tnum text-ink-600">
                    Debits {formatMoney(totals.debit, "NGN")} · Credits{" "}
                    {formatMoney(totals.credit, "NGN")}
                    {totals.balanced ? " · Balanced" : ""}
                </p>
            </div>
        </form>
    );
}

function ReverseDialog({
    entry,
    onOpenChange,
}: {
    entry: JournalEntry | null;
    onOpenChange: (open: boolean) => void;
}) {
    const toast = useToast();
    const reverse = useReverseEntry();
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!entry) return;
        if (!reason.trim()) return setError("Say why the entry is being reversed.");
        try {
            await reverse.mutateAsync({ id: entry.id, reason: reason.trim() });
            toast({ title: "Entry reversed", tone: "success" });
            setReason("");
            onOpenChange(false);
        } catch (failure) {
            setError(refusalMessage(failure));
        }
    }

    return (
        <Modal
            open={entry !== null}
            onOpenChange={onOpenChange}
            title="Reverse entry"
            description={entry?.description}
            size="confirm"
            footer={
                <ModalFooter
                    start={
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                    }
                    end={
                        <Button type="submit" form="reverse-form">
                            Reverse entry
                        </Button>
                    }
                />
            }
        >
            <form id="reverse-form" noValidate onSubmit={submit}>
                <Input
                    label="Reason"
                    value={reason}
                    maxLength={200}
                    error={error ?? undefined}
                    onChange={(e) => {
                        setReason(e.target.value);
                        setError(null);
                    }}
                />
            </form>
        </Modal>
    );
}

// -- reports -----------------------------------------------------------------------------------

function Lines({
    title,
    rows,
    total,
    currency,
}: {
    title: string;
    rows: { code: string; name: string; amount_minor: number }[];
    total: number;
    currency: string;
}) {
    return (
        <section aria-label={title} className="flex flex-col gap-2">
            <h3 className="text-body text-ink-900 font-semibold">{title}</h3>
            <dl className="flex flex-col gap-1">
                {rows.map((row) => (
                    <div key={row.code} className="flex justify-between gap-4">
                        <dt className="text-ink-600">{row.name}</dt>
                        <dd className="tnum">{formatMoney(row.amount_minor, currency)}</dd>
                    </div>
                ))}
                {rows.length === 0 && (
                    <p className="text-small text-ink-500">Nothing in this period.</p>
                )}
            </dl>
            <div className="border-line flex justify-between gap-4 border-t pt-2 font-semibold">
                <span>Total {title.toLowerCase()}</span>
                <span className="tnum">{formatMoney(total, currency)}</span>
            </div>
        </section>
    );
}

function ReportFrame({
    children,
    failed,
    retry,
}: {
    children: React.ReactNode;
    failed: boolean;
    retry: () => void;
}) {
    return (
        <section className="rounded-card border-line bg-surface shadow-card flex flex-col gap-5 border p-5">
            {failed ? (
                <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
                    <p className="text-body text-ink-900 font-semibold">
                        The report could not be loaded.
                    </p>
                    <Button variant="outline" onClick={retry}>
                        Try again
                    </Button>
                </div>
            ) : (
                children
            )}
        </section>
    );
}

function IncomeTab() {
    const [start, setStart] = useState(monthStart());
    const [end, setEnd] = useState(today());
    const report = useIncomeStatement(start, end);
    const data: IncomeStatement | undefined = report.data;
    return (
        <ReportFrame failed={report.isError} retry={() => report.refetch()}>
            <div className="flex flex-wrap gap-4">
                <Input
                    label="From"
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                />
                <Input
                    label="To"
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                />
            </div>
            {data ? (
                <>
                    <Lines
                        title="Revenue"
                        rows={data.revenue}
                        total={data.total_revenue_minor}
                        currency={data.currency}
                    />
                    <Lines
                        title="Expenses"
                        rows={data.expenses}
                        total={data.total_expenses_minor}
                        currency={data.currency}
                    />
                    <p className="text-section-title tnum flex justify-between gap-4">
                        <span>{data.net_minor < 0 ? "Net loss" : "Net profit"}</span>
                        <span>{formatMoney(Math.abs(data.net_minor), data.currency)}</span>
                    </p>
                </>
            ) : (
                <p role="status" className="text-body text-ink-600">
                    Loading…
                </p>
            )}
        </ReportFrame>
    );
}

function BalanceTab() {
    const [asOf, setAsOf] = useState(today());
    const report = useBalanceSheet(asOf);
    const data: BalanceSheet | undefined = report.data;
    return (
        <ReportFrame failed={report.isError} retry={() => report.refetch()}>
            <Input
                label="As at"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="max-w-48"
            />
            {data ? (
                <>
                    <Lines
                        title="Assets"
                        rows={data.assets}
                        total={data.total_assets_minor}
                        currency={data.currency}
                    />
                    <Lines
                        title="Liabilities"
                        rows={data.liabilities}
                        total={data.total_liabilities_minor}
                        currency={data.currency}
                    />
                    <Lines
                        title="Equity"
                        rows={[
                            ...data.equity,
                            {
                                code: "profit",
                                name: "Profit to date",
                                amount_minor: data.profit_to_date_minor,
                            },
                        ]}
                        total={data.total_equity_minor}
                        currency={data.currency}
                    />
                </>
            ) : (
                <p role="status" className="text-body text-ink-600">
                    Loading…
                </p>
            )}
        </ReportFrame>
    );
}
