import { Coins, Stethoscope, User } from "@phosphor-icons/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { STOCK_SERIES } from "@/lib/chart-colours";
import { APPOINTMENT_STATUS, PAYMENT_STATUS } from "@/lib/status-map";

import { Avatar } from "./avatar";
import { Banner } from "./banner";
import { Card } from "./card";
import { DonutLegend } from "./donut-legend";
import { EmptyState } from "./empty-state";
import { FeedbackButton } from "./feedback-button";
import { DeltaChip, KpiBlock } from "./kpi";
import { MiniTiles } from "./mini-tile";
import { ProgressBar, SegmentedStatBar } from "./progress";
import { Loading, Skeleton } from "./skeleton";
import { StatusPill } from "./status-pill";
import { Stepper, stepState } from "./stepper";

describe("Card", () => {
  it("is a region named by its title, with the action on the right", () => {
    render(
      <Card title="Cashflow" action={<button type="button">View all</button>}>
        <p>Body</p>
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Cashflow" });
    expect(within(card).getByRole("heading", { level: 2, name: "Cashflow" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "View all" })).toBeInTheDocument();
  });

  it("can use a level 3 heading", () => {
    render(
      <Card title="Vitals" as="h3">
        x
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Vitals" })).toBeInTheDocument();
  });
});

describe("KpiBlock and DeltaChip", () => {
  it("shows the label, value, delta and caption", () => {
    render(
      <KpiBlock
        label="Total cash"
        value="₦13,232.00"
        delta={12.5}
        icon={{ icon: Coins, tone: "amber" }}
        caption="vs last month"
      />,
    );
    expect(screen.getByText("Total cash")).toBeInTheDocument();
    expect(screen.getByText("₦13,232.00")).toBeInTheDocument();
    expect(screen.getByText("vs last month")).toBeInTheDocument();
    expect(screen.getByText("12.5%").parentElement).toHaveTextContent("Up12.5%");
  });

  it("is green when going the good way and pink otherwise; direction is in text too", () => {
    const { rerender } = render(<DeltaChip value={-3} />);
    let chip = screen.getByText("3%").closest("span")!;
    expect(chip.className).toContain("text-pink-text");
    expect(chip).toHaveTextContent("Down3%");

    rerender(<DeltaChip value={-3} goodWhen="down" />);
    chip = screen.getByText("3%").closest("span")!;
    expect(chip.className).toContain("text-green-text");

    rerender(<DeltaChip value={0} />);
    chip = screen.getByText("0%").closest("span")!;
    expect(chip.className).toContain("text-ink-600");
    expect(chip).toHaveTextContent("No change,0%");
  });
});

describe("StatusPill", () => {
  it("shows the label with the status tone from status-map", () => {
    render(
      <>
        <StatusPill status={PAYMENT_STATUS.unpaid} />
        <StatusPill status={APPOINTMENT_STATUS.checked_in} />
      </>,
    );
    expect(screen.getByText("Unpaid").className).toContain("bg-pink-tint text-pink-text");
    expect(screen.getByText("Checked-In").className).toContain("bg-teal-tint text-teal-text");
  });
});

describe("Avatar", () => {
  it("shows a photo and falls back to initials if it fails to load", () => {
    const { container } = render(<Avatar name="Ada Tester" src="https://example.test/a.jpg" />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://example.test/a.jpg");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("AT");
  });

  it("can carry the name for screen readers when shown alone", () => {
    render(<Avatar name="Ada Tester" labelled size={40} />);
    expect(screen.getByRole("img", { name: "Ada Tester" })).toHaveClass("size-10");
  });
});

describe("ProgressBar", () => {
  it("reports progress and the fraction", () => {
    render(<ProgressBar label="Items received" value={2} max={4} />);
    const bar = screen.getByRole("progressbar", { name: "Items received" });
    expect(bar).toHaveAttribute("aria-valuetext", "2 of 4");
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(bar.firstElementChild).toHaveClass("bg-blue-600");
  });

  it("turns green when complete and clamps out-of-range values", () => {
    render(<ProgressBar label="Done" value={9} max={4} />);
    const bar = screen.getByRole("progressbar", { name: "Done" });
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar.firstElementChild).toHaveClass("bg-green");
  });
});

describe("SegmentedStatBar", () => {
  it("lists each segment with its count", () => {
    render(
      <SegmentedStatBar
        label="Stock levels"
        segments={[
          { label: "In stock", value: 20, fill: STOCK_SERIES.available },
          { label: "Low stock", value: 4, fill: STOCK_SERIES.low },
          { label: "Out of stock", value: 0, fill: STOCK_SERIES.out },
        ]}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Stock levels" });
    expect(within(figure).getByText("In stock").parentElement).toHaveTextContent("In stock20");
    expect(within(figure).getByText("Out of stock").parentElement).toHaveTextContent(
      "Out of stock0",
    );
  });
});

describe("DonutLegend", () => {
  it("shows whole percentages in the series order", () => {
    render(
      <DonutLegend
        label="Expenses by category"
        items={[
          { label: "Salaries", value: 50 },
          { label: "Supplies", value: 30 },
          { label: "Utilities", value: 20 },
        ]}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Expenses by category" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((r) => r.textContent)).toEqual(["Salaries50%", "Supplies30%", "Utilities20%"]);
    expect(rows[0].firstElementChild).toHaveClass("bg-purple");
  });
});

describe("MiniTiles", () => {
  it("pairs each label with its value", () => {
    render(<MiniTiles items={[{ label: "Top expense", value: "Salaries", tone: "amber" }]} />);
    expect(screen.getByRole("term")).toHaveTextContent("Top expense");
    expect(screen.getByRole("definition")).toHaveTextContent("Salaries");
  });
});

describe("Banner", () => {
  it("shows an info banner with an action", () => {
    render(
      <Banner action={<button type="button">Extend time</button>}>
        Time slot available later.
      </Banner>,
    );
    expect(screen.getByText("Time slot available later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extend time" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a danger banner with a title; announced only when live", () => {
    const { rerender } = render(
      <Banner tone="danger" title="Allergy: Penicillin">
        Severe: anaphylaxis
      </Banner>,
    );
    expect(screen.getByText("Allergy: Penicillin")).toHaveClass("text-pink-text");
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <Banner tone="danger" title="Save failed" live>
        Try again.
      </Banner>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Save failedTry again.");
  });
});

describe("Stepper", () => {
  const steps = [
    { label: "Visit", icon: Stethoscope },
    { label: "Patient", icon: User },
    { label: "History", icon: Coins },
  ];

  it("works out done, active and upcoming", () => {
    expect([0, 1, 2].map((i) => stepState(i, 1))).toEqual(["done", "active", "upcoming"]);
  });

  it("marks the current step and says each state", () => {
    render(<Stepper steps={steps} current={1} />);
    const current = screen.getByText(/^Patient/).closest("li")!;
    expect(current).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/^Visit/)).toHaveTextContent("Visit, completed");
    expect(screen.getByText(/^History/)).toHaveTextContent("History, not started");
    expect(screen.getByText("Step 3")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows one sentence and one action", () => {
    render(
      <EmptyState title="No appointments today." action={<button type="button">Book</button>} />,
    );
    expect(screen.getByText("No appointments today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book" })).toBeInTheDocument();
  });
});

describe("Skeleton and Loading", () => {
  it("hides the blocks and announces one loading message", () => {
    render(
      <Loading label="Loading patients">
        <Skeleton className="h-4 w-32" />
      </Loading>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading patients");
    expect(status.querySelector("[aria-hidden]")).toHaveClass("bg-skeleton", "h-4", "w-32");
  });
});

describe("FeedbackButton", () => {
  it("floats by default and calls back on click", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<FeedbackButton onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Feedback" })).toHaveClass("fixed");
    await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<FeedbackButton onClick={onClick} floating={false} />);
    expect(screen.getByRole("button", { name: "Feedback" })).not.toHaveClass("fixed");
  });
});
