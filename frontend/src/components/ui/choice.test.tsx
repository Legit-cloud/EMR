import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChoiceChips, RadioCards } from "./choice";
import { SegmentedControl } from "./segmented-control";
import { Tabs } from "./tabs";

const GENDER = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

describe("ChoiceChips", () => {
  it("is a named radio group whose chips select on click", async () => {
    const onValueChange = vi.fn();
    render(<ChoiceChips legend="Gender" options={GENDER} onValueChange={onValueChange} />);
    expect(screen.getByRole("group", { name: "Gender" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(onValueChange).toHaveBeenCalledWith("male");
    expect(screen.getByRole("radio", { name: "Male" })).toBeChecked();
  });

  it("follows a controlled value and shows an error", () => {
    render(<ChoiceChips legend="Gender" options={GENDER} value="female" error="Choose one." />);
    expect(screen.getByRole("radio", { name: "Female" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Male" })).not.toBeChecked();
    expect(screen.getByRole("group", { name: "Gender" })).toHaveAccessibleDescription(
      "Choose one.",
    );
  });
});

describe("RadioCards", () => {
  it("shows a description under each label", async () => {
    render(
      <RadioCards
        legend="Do you smoke?"
        columns={3}
        options={[
          { value: "never", label: "Never" },
          { value: "former", label: "Former", description: "Stopped over a year ago" },
          { value: "current", label: "Current" },
        ]}
      />,
    );
    const former = screen.getByRole("radio", { name: /Former/ });
    expect(screen.getByText("Stopped over a year ago")).toBeInTheDocument();
    await userEvent.click(former);
    expect(former).toBeChecked();
  });
});

describe("SegmentedControl", () => {
  it("switches between options and keeps one checked", async () => {
    function View() {
      const [view, setView] = useState<"day" | "week">("day");
      return (
        <SegmentedControl
          label="Calendar view"
          value={view}
          onValueChange={setView}
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
          ]}
        />
      );
    }
    render(<View />);
    expect(screen.getByRole("radiogroup", { name: "Calendar view" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Day" })).toBeChecked();
    await userEvent.click(screen.getByText("Week"));
    expect(screen.getByRole("radio", { name: "Week" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Day" })).not.toBeChecked();
  });
});

describe("Tabs", () => {
  const items = [
    { value: "calendar", label: "Calendar", content: <p>Calendar panel</p> },
    { value: "log", label: "Log History", count: 12, content: <p>Log panel</p> },
  ];

  it("shows the first panel, switches on click and shows counts", async () => {
    render(<Tabs label="Appointments" items={items} />);
    expect(screen.getByRole("tablist", { name: "Appointments" })).toBeInTheDocument();
    expect(screen.getByText("Calendar panel")).toBeVisible();
    const log = screen.getByRole("tab", { name: /Log History/ });
    expect(log).toHaveTextContent("12");
    await userEvent.click(log);
    expect(log).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Log panel")).toBeVisible();
  });

  it("moves between tabs with the arrow keys", async () => {
    render(<Tabs label="Appointments" items={items} />);
    screen.getByRole("tab", { name: "Calendar" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Log History/ })).toHaveFocus();
  });
});
