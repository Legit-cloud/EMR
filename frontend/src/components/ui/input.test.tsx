import { Phone } from "@phosphor-icons/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Input, Textarea } from "./input";
import { SearchPill } from "./search-pill";

describe("Input", () => {
  it("is labelled by the text above it and marks optional fields", () => {
    render(<Input label="Email" optional icon={Phone} />);
    expect(screen.getByRole("textbox", { name: /Email/ })).toBeInTheDocument();
    expect(screen.getByText("(Optional)")).toBeInTheDocument();
  });

  it("counts characters as the user types", async () => {
    const onChange = vi.fn();
    render(<Input label="Reason" maxLength={20} showCount onChange={onChange} />);
    expect(screen.getByText("0/20")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "Fever");
    expect(screen.getByText("5/20")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("counts a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState("ab");
      return (
        <Input
          label="Note"
          maxLength={10}
          showCount
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      );
    }
    render(<Controlled />);
    expect(screen.getByText("2/10")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Note" }), "c");
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("shows an error, marks the field invalid and links the message", () => {
    render(<Input label="Phone" error="Enter a phone number in E.164 format." />);
    const field = screen.getByRole("textbox", { name: "Phone" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Enter a phone number in E.164 format.");
  });

  it("links a hint when there is no error", () => {
    render(<Input label="National ID" hint="Leave blank if unknown." />);
    expect(screen.getByRole("textbox", { name: "National ID" })).toHaveAccessibleDescription(
      "Leave blank if unknown.",
    );
  });

  it("can be disabled", () => {
    render(<Input label="MRN" disabled defaultValue="2026-000123" />);
    expect(screen.getByRole("textbox", { name: "MRN" })).toBeDisabled();
  });
});

describe("Textarea", () => {
  it("counts characters and starts from the default value", async () => {
    render(<Textarea label="Quick note" maxLength={200} showCount defaultValue="Hi" />);
    expect(screen.getByText("2/200")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Quick note" }), "!");
    expect(screen.getByText("3/200")).toBeInTheDocument();
  });
});

describe("SearchPill", () => {
  it("is a labelled search box in both looks", () => {
    render(
      <>
        <SearchPill label="Search patients" placeholder="Search" />
        <SearchPill label="Search stock" variant="table" />
      </>,
    );
    expect(screen.getByRole("searchbox", { name: "Search patients" }).className).toContain(
      "bg-search-fill",
    );
    expect(screen.getByRole("searchbox", { name: "Search stock" }).className).toContain(
      "bg-surface",
    );
  });
});
