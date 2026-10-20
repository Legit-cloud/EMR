import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type Column, DataTable, nextSort, type Sort } from "./data-table";

type Row = { id: string; name: string; units: number };

const ROWS: Row[] = [
  { id: "a", name: "Amoxicillin", units: 12 },
  { id: "b", name: "Ibuprofen", units: 80 },
  { id: "c", name: "Metformin", units: 0 },
];

const COLUMNS: Column<Row>[] = [
  { id: "name", header: "Drug", sortKey: "name", cell: (r) => r.name },
  { id: "units", header: "Units", cell: (r) => r.units },
];

const EMPTY = <p>Nothing here.</p>;

function table(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return (
    <DataTable<Row>
      caption="Drugs"
      columns={COLUMNS}
      rows={ROWS}
      rowId={(r) => r.id}
      rowLabel={(r) => r.name}
      empty={EMPTY}
      {...props}
    />
  );
}

describe("DataTable", () => {
  it("is a table named by its caption with a header row and a row per record", () => {
    render(table());
    const grid = screen.getByRole("table", { name: "Drugs" });
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Drug", "Units"]);
    expect(within(grid).getAllByRole("row")).toHaveLength(4);
    expect(within(grid).getByRole("cell", { name: "Ibuprofen" })).toBeInTheDocument();
  });

  it("cycles a sortable column: ascending, descending, then the default order", async () => {
    const onSort = vi.fn();
    const { rerender } = render(table({ sort: null, onSortChange: onSort }));
    const header = screen.getByRole("columnheader", { name: /Drug/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    // Columns without a sort key are plain text, not buttons.
    expect(
      within(screen.getByRole("columnheader", { name: "Units" })).queryByRole("button"),
    ).toBeNull();

    await userEvent.click(within(header).getByRole("button", { name: /Drug/ }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "name", direction: "asc" });

    const asc: Sort = { key: "name", direction: "asc" };
    rerender(table({ sort: asc, onSortChange: onSort }));
    expect(screen.getByRole("columnheader", { name: /Drug/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await userEvent.click(screen.getByRole("button", { name: /Drug/ }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "name", direction: "desc" });

    rerender(table({ sort: { key: "name", direction: "desc" }, onSortChange: onSort }));
    expect(screen.getByRole("columnheader", { name: /Drug/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await userEvent.click(screen.getByRole("button", { name: /Drug/ }));
    expect(onSort).toHaveBeenLastCalledWith(null);
  });

  it("nextSort starts a different column ascending", () => {
    expect(nextSort({ key: "name", direction: "desc" }, "mrn")).toEqual({
      key: "mrn",
      direction: "asc",
    });
  });

  it("selects rows and all rows, with a mixed state for some", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      table({ selectable: true, selected: new Set(), onSelectedChange: onChange }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Ibuprofen" }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(["b"]));

    rerender(table({ selectable: true, selected: new Set(["b"]), onSelectedChange: onChange }));
    const all = screen.getByRole("checkbox", { name: "Select all rows on this page" });
    expect((all as HTMLInputElement).indeterminate).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Select Ibuprofen" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Ibuprofen" }).closest("tr"),
    ).toHaveAttribute("data-selected", "true");

    await userEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["a", "b", "c"]));
    rerender(
      table({ selectable: true, selected: new Set(["a", "b", "c"]), onSelectedChange: onChange }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all rows on this page" }));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });

  it("shows loading skeletons, not a table, until the first rows arrive", () => {
    render(table({ rows: undefined }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading drugs");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no rows", () => {
    render(table({ rows: [] }));
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error with a retry, but keeps old rows if a refresh fails", async () => {
    const retry = vi.fn();
    const { rerender } = render(table({ rows: undefined, error: true, onRetry: retry }));
    expect(screen.getByRole("alert")).toHaveTextContent("Drugs could not be loaded.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(table({ rows: ROWS, error: true, onRetry: retry }));
    expect(screen.getByRole("table", { name: "Drugs" })).toBeInTheDocument();
  });

  it("marks the table busy and dimmed while a refetch keeps the old rows", () => {
    render(table({ refreshing: true }));
    expect(screen.getByRole("table").parentElement).toHaveAttribute("aria-busy", "true");
  });

  it("has an actions column with a hidden heading", () => {
    render(table({ actions: (r) => <button type="button">Menu for {r.name}</button> }));
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menu for Metformin" })).toBeInTheDocument();
  });

  it("shows the range, steps pages and changes the page size", async () => {
    const onPage = vi.fn();
    const onSize = vi.fn();
    const pagination = {
      page: 2,
      pageSize: 10,
      total: 23,
      onPageChange: onPage,
      onPageSizeChange: onSize,
    };
    const { rerender } = render(table({ pagination }));
    const bar = screen.getByRole("navigation", { name: "Pagination" });
    expect(bar).toHaveTextContent("11–20 of 23");
    await userEvent.click(within(bar).getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenLastCalledWith(3);
    await userEvent.click(within(bar).getByRole("button", { name: "Previous" }));
    expect(onPage).toHaveBeenLastCalledWith(1);

    await userEvent.click(within(bar).getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(await screen.findByRole("option", { name: "50" }));
    expect(onSize).toHaveBeenLastCalledWith(50);

    rerender(table({ pagination: { ...pagination, page: 3 } }));
    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent("21–23 of 23");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    rerender(table({ pagination: { ...pagination, page: 1 } }));
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
