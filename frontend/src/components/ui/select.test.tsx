import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox";
import { RangeSelect, Select } from "./select";

const SERVICES = [
  { value: "checkup", label: "General Checkup" },
  { value: "follow_up", label: "Follow-up" },
  { value: "vaccination", label: "Vaccination", disabled: true },
];

describe("Select", () => {
  it("is labelled, shows the placeholder and picks an option", async () => {
    const onValueChange = vi.fn();
    render(<Select label="Service" options={SERVICES} onValueChange={onValueChange} />);
    const trigger = screen.getByRole("combobox", { name: "Service" });
    expect(trigger).toHaveTextContent("Select");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "Follow-up" }));
    expect(onValueChange).toHaveBeenCalledWith("follow_up");
    expect(trigger).toHaveTextContent("Follow-up");
  });

  it("marks an error on the trigger", () => {
    render(<Select label="Service" options={SERVICES} error="Choose a service." />);
    const trigger = screen.getByRole("combobox", { name: "Service" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("Choose a service.");
  });
});

describe("RangeSelect", () => {
  it("shows the current range and changes it", async () => {
    function Range() {
      const [value, setValue] = useState("12m");
      return (
        <RangeSelect
          label="Cashflow period"
          value={value}
          onValueChange={setValue}
          options={[
            { value: "12m", label: "Last 12 months" },
            { value: "month", label: "This month" },
          ]}
        />
      );
    }
    render(<Range />);
    const trigger = screen.getByRole("combobox", { name: "Cashflow period" });
    expect(trigger).toHaveTextContent("Last 12 months");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "This month" }));
    expect(trigger).toHaveTextContent("This month");
  });
});

const DRUGS = [
  { value: "amox", label: "Amoxicillin 500 mg" },
  { value: "para", label: "Paracetamol 500 mg" },
  { value: "metf", label: "Metformin 850 mg" },
];

function Drugs({ onChange = vi.fn() }: { onChange?: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      label="Drug"
      options={DRUGS}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("Combobox", () => {
  it("filters the list as the user types and picks with the mouse", async () => {
    render(<Drugs />);
    const input = screen.getByRole("combobox", { name: "Drug" });
    await userEvent.type(input, "500");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Amoxicillin 500 mg", "Paracetamol 500 mg"]);
    await userEvent.click(screen.getByRole("option", { name: "Paracetamol 500 mg" }));
    expect(input).toHaveValue("Paracetamol 500 mg");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("works from the keyboard: arrows move, Enter picks, focus stays in the input", async () => {
    const onChange = vi.fn();
    render(<Drugs onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Drug" });
    input.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Paracetamol 500 mg" }).id,
    );
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("para");
    expect(input).toHaveFocus();
  });

  it("says when nothing matches and closes on Escape", async () => {
    render(<Drugs />);
    const input = screen.getByRole("combobox", { name: "Drug" });
    await userEvent.type(input, "zzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the selected option", async () => {
    render(<Drugs />);
    const input = screen.getByRole("combobox", { name: "Drug" });
    await userEvent.click(input);
    await userEvent.click(await screen.findByRole("option", { name: "Metformin 850 mg" }));
    await userEvent.click(input);
    expect(await screen.findByRole("option", { name: "Metformin 850 mg" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
