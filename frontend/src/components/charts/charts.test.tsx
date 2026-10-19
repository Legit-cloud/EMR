import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SegmentedStatBar } from "@/components/ui/progress";
import {
  DONUT_PAINT,
  DONUT_SERIES,
  INCOME_EXPENSE_SERIES,
  STOCK_SERIES,
} from "@/lib/chart-colours";
import { formatMoney } from "@/lib/format";

import { AreaLineChart } from "./area-line-chart";
import { describeSeries } from "./chart-frame";
import { DonutChart } from "./donut-chart";
import { PairedBarChart } from "./paired-bar-chart";
import { Sparkline } from "./sparkline";

// Synthetic sample data only. Money in kobo.
const CASHFLOW = [
  { label: "Jan", value: 400_000 },
  { label: "Feb", value: 900_000 },
  { label: "Mar", value: 250_000 },
];
const naira = (minor: number) => formatMoney(minor, "NGN");

describe("describeSeries", () => {
  it("names the span, the highest, the lowest and the latest value", () => {
    expect(describeSeries(CASHFLOW, naira, "months")).toBe(
      "3 months from Jan to Mar. Highest ₦9,000.00 in Feb; lowest ₦2,500.00 in Mar; latest ₦2,500.00.",
    );
    expect(describeSeries([], naira)).toBe("No data.");
  });
});

describe("AreaLineChart", () => {
  it("is a figure with a text summary and a data table for screen readers", () => {
    render(<AreaLineChart label="Cashflow" data={CASHFLOW} formatValue={naira} />);
    const figure = screen.getByRole("figure", { name: /Cashflow\. 3 points from Jan to Mar/ });
    const table = within(figure).getByRole("table", { name: "Cashflow, as a table" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveTextContent("Feb₦9,000.00");
  });

  it("swaps the picture for the table and back", async () => {
    render(<AreaLineChart label="Cashflow" data={CASHFLOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByRole("table").parentElement).not.toHaveClass("sr-only");
    await userEvent.click(screen.getByRole("button", { name: "Show chart" }));
    expect(screen.getByRole("table").parentElement).toHaveClass("sr-only");
  });

  it("keeps the range selector in its slot", () => {
    render(
      <AreaLineChart
        label="Cashflow"
        data={CASHFLOW}
        rangeSelector={<button type="button">Last 12 months</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Last 12 months" })).toBeInTheDocument();
  });

  it("shows an empty state, and no table or toggle, when there is no data", () => {
    render(
      <AreaLineChart
        label="Cashflow"
        data={[]}
        emptyText="No payments this month."
        rangeSelector={<button type="button">This month</button>}
      />,
    );
    expect(screen.getByText("No payments this month.")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show table" })).not.toBeInTheDocument();
    // The range selector stays so the user can pick another period.
    expect(screen.getByRole("button", { name: "This month" })).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    render(<AreaLineChart label="Cashflow" data={[]} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading cashflow");
    expect(screen.queryByText("No data for this period.")).not.toBeInTheDocument();
  });
});

describe("PairedBarChart", () => {
  const months = [
    { label: "Jan", income: 500_000, expense: 200_000 },
    { label: "Feb", income: 300_000, expense: 350_000 },
  ];

  it("has a legend for both series and sums them in the summary", () => {
    render(<PairedBarChart label="Income and expense" data={months} formatValue={naira} />);
    const figure = screen.getByRole("figure", {
      name: "Income and expense. Jan to Feb. Total income ₦8,000.00; total expense ₦5,500.00.",
    });
    const legend = within(figure).getAllByRole("list")[0];
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Income", "Expense"]);
    const rows = within(figure).getAllByRole("row");
    expect(rows[0]).toHaveTextContent("PeriodIncomeExpense");
    expect(rows[2]).toHaveTextContent("Feb₦3,000.00₦3,500.00");
  });

  it("shows the empty state without a legend when there is no data", () => {
    render(<PairedBarChart label="Income and expense" data={[]} />);
    expect(screen.getByText("No income or expenses for this period.")).toBeInTheDocument();
    expect(screen.queryByText("Income")).not.toBeInTheDocument();
  });
});

describe("DonutChart", () => {
  const expenses = [
    { label: "Salaries", value: 600_000 },
    { label: "Drugs", value: 300_000 },
    { label: "Utilities", value: 100_000 },
  ];

  it("renders the legend with dot, name and percent, and the total in the centre", () => {
    render(<DonutChart label="Expenses" data={expenses} formatValue={naira} />);
    const legend = screen.getByRole("list", { name: "Expenses legend" });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Salaries60%", "Drugs30%", "Utilities10%"]);
    expect(items[0].querySelector("span")).toHaveClass(DONUT_SERIES[0]);
    expect(screen.getByText("₦10,000.00")).toBeInTheDocument();
    expect(
      screen.getByRole("figure", {
        name: "Expenses. Total ₦10,000.00. Salaries 60%, Drugs 30%, Utilities 10%.",
      }),
    ).toBeInTheDocument();
  });

  it("does not offer a table toggle: the legend already lists every share", () => {
    render(<DonutChart label="Expenses" data={expenses} />);
    expect(screen.queryByRole("button", { name: "Show table" })).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Expenses, as a table" })).toBeInTheDocument();
  });

  it("treats an all-zero breakdown as empty", () => {
    render(<DonutChart label="Expenses" data={[{ label: "Salaries", value: 0 }]} />);
    expect(screen.getByText("Nothing to show for this period.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Expenses legend" })).not.toBeInTheDocument();
  });
});

describe("Sparkline", () => {
  it("is an image described by its trend", () => {
    render(<Sparkline label="Heart rate" data={CASHFLOW} />);
    expect(
      screen.getByRole("img", { name: /^Heart rate\. 3 readings from Jan to Mar\./ }),
    ).toBeInTheDocument();
  });

  it("falls back to text with fewer than two points, and a skeleton while loading", () => {
    const { rerender } = render(<Sparkline label="Heart rate" data={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    rerender(<Sparkline label="Heart rate" data={[{ label: "Mon", value: 72 }]} />);
    expect(screen.getByText("72")).toBeInTheDocument();
    rerender(<Sparkline label="Heart rate" data={[]} loading />);
    expect(screen.getByRole("status", { name: "Loading heart rate" })).toBeInTheDocument();
  });
});

describe("SegmentedStatBar states", () => {
  it("shows a skeleton while loading and a message when every segment is zero", () => {
    const segments = [
      { label: "In stock", value: 0, fill: STOCK_SERIES.available },
      { label: "Out of stock", value: 0, fill: STOCK_SERIES.out },
    ];
    const { rerender } = render(<SegmentedStatBar label="Stock" segments={segments} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading stock");
    rerender(<SegmentedStatBar label="Stock" segments={segments} emptyText="No stock yet." />);
    expect(screen.getByText("No stock yet.")).toBeInTheDocument();
  });
});

describe("chart colours (docs/DESIGN.md Section 2.3)", () => {
  it("paints SVG series with the same tokens the legend dots use", () => {
    const token = (cls: string) => `var(--${cls.replace(/^bg-/, "")})`;
    expect(DONUT_SERIES.map(token)).toEqual([...DONUT_PAINT]);
    for (const series of Object.values(INCOME_EXPENSE_SERIES)) {
      expect(token(series.dot)).toBe(series.paint);
    }
  });
});
