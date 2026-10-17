import { Plus, Sliders } from "@phosphor-icons/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, type ButtonVariant, IconButton } from "./button";

describe("Button", () => {
  it.each<ButtonVariant>(["primary", "outline", "neutral", "ghost", "dashed", "success"])(
    "renders the %s variant as a clickable button with a focus ring",
    async (variant) => {
      const onClick = vi.fn();
      render(
        <Button variant={variant} icon={Sliders} onClick={onClick}>
          Filters
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Filters" });
      expect(button).toHaveAttribute("type", "button");
      expect(button.className).toContain("focus-visible:outline-blue-600");
      await userEvent.click(button);
      expect(onClick).toHaveBeenCalledOnce();
    },
  );

  it("does nothing when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Finish
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("blocks clicks and reports busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("submits a form only when asked to", () => {
    render(<Button type="submit">Sign in</Button>);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("type", "submit");
  });
});

describe("IconButton", () => {
  it("is named by its label, since the icon has no text", async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Plus} label="Create new" variant="add" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Create new" });
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("bg-blue-600");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("uses the ghost look by default", () => {
    render(<IconButton icon={Plus} label="More" />);
    expect(screen.getByRole("button", { name: "More" }).className).not.toContain("bg-blue-600");
  });
});
