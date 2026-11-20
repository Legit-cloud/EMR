import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Showcase } from "./showcase";
import { SLIDES } from "./slides";

function slide(n: number) {
  // Hidden slides have no accessible name, so find them by their slide marker.
  return document.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]')[n - 1];
}

function reducedMotion(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: on && query.includes("prefers-reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => reducedMotion(false));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sign-up carousel", () => {
  it("has three slides and shows the first", () => {
    render(<Showcase />);
    expect(SLIDES).toHaveLength(3);
    expect(
      screen.getByRole("region", { name: "What you can do with the system" }),
    ).toBeInTheDocument();
    expect(slide(1)).toHaveAttribute("aria-hidden", "false");
    expect(slide(2)).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("heading", { name: SLIDES[0].title, hidden: false }),
    ).toBeInTheDocument();
  });

  it("describes each picture for screen readers", () => {
    render(<Showcase />);
    expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(3);
  });

  it("moves with the arrows and wraps round", async () => {
    render(<Showcase />);
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(slide(2)).toHaveAttribute("aria-hidden", "false");
    await userEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(slide(3)).toHaveAttribute("aria-hidden", "false");
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(slide(1)).toHaveAttribute("aria-hidden", "false");
  });

  it("jumps with the dots and marks the current one", async () => {
    render(<Showcase />);
    await userEvent.click(screen.getByRole("button", { name: "Show slide 3 of 3" }));
    expect(slide(3)).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("button", { name: "Show slide 3 of 3" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Show slide 1 of 3" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("advances by itself every six seconds", () => {
    vi.useFakeTimers();
    render(<Showcase />);
    act(() => vi.advanceTimersByTime(6000));
    expect(slide(2)).toHaveAttribute("aria-hidden", "false");
    act(() => vi.advanceTimersByTime(12000));
    expect(slide(1)).toHaveAttribute("aria-hidden", "false");
  });

  it("stops while the pointer is over it and starts again after", () => {
    vi.useFakeTimers();
    render(<Showcase />);
    const region = screen.getByRole("region", { name: "What you can do with the system" });
    act(() => {
      region.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    // React listens for mouseenter through mouseover on the container.
    act(() => vi.advanceTimersByTime(20000));
    expect(slide(1)).toHaveAttribute("aria-hidden", "false");
  });

  it("does not move by itself when the system asks for less motion", () => {
    reducedMotion(true);
    vi.useFakeTimers();
    render(<Showcase />);
    act(() => vi.advanceTimersByTime(30000));
    expect(slide(1)).toHaveAttribute("aria-hidden", "false");
  });
});
