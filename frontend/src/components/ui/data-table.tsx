"use client";

import { CaretDown, CaretLeft, CaretRight, CaretUp, CaretUpDown } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cx } from "@/lib/cx";

import { Button } from "./button";
import { FOCUS_RING } from "./focus";
import { RangeSelect } from "./select";
import { Loading, Skeleton } from "./skeleton";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The sort key the data source understands; omit when the column cannot be sorted. */
  sortKey?: string;
  className?: string;
};

export type Sort = { key: string; direction: "asc" | "desc" };

export type Pagination = {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizes?: number[];
};

type Props<T> = {
  /** Names the table for screen readers, for example "Patients". */
  caption: string;
  columns: Column<T>[];
  /** undefined while the first load is running. */
  rows: T[] | undefined;
  rowId: (row: T) => string;
  /** Shown instead of the table when there are no rows: an EmptyState. */
  empty: ReactNode;
  /** True while a refetch keeps the previous rows on screen. */
  refreshing?: boolean;
  error?: boolean;
  onRetry?: () => void;
  sort?: Sort | null;
  onSortChange?: (sort: Sort | null) => void;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Names a row for its checkbox, for example "Ada Okafor". */
  rowLabel?: (row: T) => string;
  /** The kebab menu cell. */
  actions?: (row: T) => ReactNode;
  pagination?: Pagination;
};

/** Next click on a sorted column: ascending, descending, then back to the default order. */
export function nextSort(current: Sort | null | undefined, key: string): Sort | null {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}

const CHECKBOX = cx(
  "size-4 shrink-0 cursor-pointer rounded-tag border-ink-300 accent-blue-600",
  FOCUS_RING,
);

function SortIcon({ direction }: { direction: "asc" | "desc" | null }) {
  const Glyph = direction === "asc" ? CaretUp : direction === "desc" ? CaretDown : CaretUpDown;
  return (
    <Glyph
      aria-hidden
      size={12}
      weight={direction ? "bold" : "regular"}
      className={direction ? "text-blue-600" : "text-ink-400"}
    />
  );
}

/**
 * The data table from docs/DESIGN.md 7.1: no outer border, rows ruled by `line`, a
 * label-caps header on surface-muted, 56 px rows, hover and selected fills, optional
 * select-all, sortable headers, a kebab column and pagination. It handles the loading,
 * empty and error states; "no permission" is the page's to show.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowId,
  empty,
  refreshing = false,
  error = false,
  onRetry,
  sort,
  onSortChange,
  selectable = false,
  selected,
  onSelectedChange,
  rowLabel,
  actions,
  pagination,
}: Props<T>) {
  if (error && rows === undefined) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body text-ink-900 font-semibold">{caption} could not be loaded.</p>
        <p className="text-small text-ink-600">Check your connection and try again.</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (rows === undefined) {
    return (
      <Loading label={`Loading ${caption.toLowerCase()}`}>
        <div className="flex flex-col">
          <Skeleton className="h-10 w-full rounded-none" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="border-line flex h-14 items-center gap-4 border-t px-4">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </Loading>
    );
  }
  if (rows.length === 0) return <>{empty}</>;

  const ids = rows.map(rowId);
  const chosen = selected ?? new Set<string>();
  const allChosen = ids.length > 0 && ids.every((id) => chosen.has(id));
  const someChosen = ids.some((id) => chosen.has(id));

  function toggleAll() {
    const next = new Set(chosen);
    for (const id of ids) {
      if (allChosen) next.delete(id);
      else next.add(id);
    }
    onSelectedChange?.(next);
  }

  function toggleRow(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange?.(next);
  }

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto" aria-busy={refreshing || undefined}>
        <table className={cx("text-body w-full text-left", refreshing && "opacity-60")}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted text-label-caps text-ink-500 h-10 uppercase">
            <tr>
              {selectable && (
                <th scope="col" className="w-12 px-4">
                  <SelectAll
                    checked={allChosen}
                    indeterminate={someChosen && !allChosen}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((column) => {
                const direction = sort && sort.key === column.sortKey ? sort.direction : null;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      column.sortKey
                        ? direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={cx("px-4 whitespace-nowrap", column.className)}
                  >
                    {column.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(sort, column.sortKey!))}
                        className={cx(
                          "rounded-tag -mx-1 inline-flex items-center gap-1 px-1 uppercase",
                          FOCUS_RING,
                        )}
                      >
                        {column.header}
                        <SortIcon direction={direction} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {actions && (
                <th scope="col" className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowId(row);
              const isChosen = chosen.has(id);
              return (
                <tr
                  key={id}
                  data-selected={isChosen || undefined}
                  className={cx(
                    "border-line h-14 border-t transition-colors duration-150",
                    isChosen ? "bg-blue-100" : "hover:bg-surface-muted",
                  )}
                >
                  {selectable && (
                    <td className="w-12 px-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${rowLabel?.(row) ?? id}`}
                        checked={isChosen}
                        onChange={() => toggleRow(id)}
                        className={CHECKBOX}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.id} className={cx("px-4 py-2", column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                  {actions && <td className="w-14 px-4 text-right">{actions(row)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination && <PaginationBar {...pagination} />}
    </div>
  );
}

function SelectAll({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all rows on this page"
      checked={checked}
      onChange={onChange}
      className={CHECKBOX}
    />
  );
}

export const PAGE_SIZES = [10, 25, 50];

/** "1–25 of 132", rows per page, and Previous and Next. */
function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = PAGE_SIZES,
}: Pagination) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      aria-label="Pagination"
      className="border-line text-small text-ink-600 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <RangeSelect
          label="Rows per page"
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
          options={pageSizes.map((size) => ({ value: String(size), label: String(size) }))}
        />
      </div>
      <p aria-live="polite" className="tnum">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          icon={CaretLeft}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
          <CaretRight aria-hidden size={16} />
        </Button>
      </div>
    </nav>
  );
}
