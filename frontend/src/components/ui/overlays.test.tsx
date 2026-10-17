import { CalendarBlank, PencilSimple, Receipt, Stethoscope, Trash } from "@phosphor-icons/react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Drawer } from "./drawer";
import { KebabMenu, Menu } from "./menu";
import { Modal, ModalFooter } from "./modal";
import { TOAST_DURATION, ToastProvider, useToast } from "./toast";
import { Tooltip, TooltipProvider } from "./tooltip";

describe("Modal", () => {
  function Wizard() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>New appointment</Button>
        <Modal
          open={open}
          onOpenChange={setOpen}
          title="New appointment"
          description="Step 1 of 3"
          footer={
            <ModalFooter
              start={
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              }
              end={<Button>Next</Button>}
            />
          }
        >
          <label>
            Service <input />
          </label>
        </Modal>
      </>
    );
  }

  it("opens as a named dialog, traps focus and closes with Escape", async () => {
    render(<Wizard />);
    const opener = screen.getByRole("button", { name: "New appointment" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "New appointment" });
    expect(dialog).toHaveAccessibleDescription("Step 1 of 3");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes from the X and from Cancel", async () => {
    render(<Wizard />);
    await userEvent.click(screen.getByRole("button", { name: "New appointment" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "New appointment" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Drawer", () => {
  const sections = [
    { value: "visit", label: "Visit", icon: CalendarBlank, content: <p>Visit details</p> },
    { value: "clinical", label: "Clinical record", icon: Stethoscope, content: <p>Notes</p> },
    { value: "billing", label: "Billing", icon: Receipt, content: <p>Bill #10102</p> },
  ];

  it("is named by its title and switches sections from the icon rail", async () => {
    render(
      <Drawer
        open
        onOpenChange={vi.fn()}
        title="Appointment #APT0011"
        heading={<span>Appointment ID #APT0011</span>}
        sections={sections}
        footer={<Button>Finish</Button>}
      />,
    );
    const drawer = screen.getByRole("dialog", { name: "Appointment #APT0011" });
    expect(within(drawer).getByText("Visit details")).toBeVisible();
    const rail = within(drawer).getByRole("tablist", { name: "Sections" });
    expect(rail).toHaveAttribute("aria-orientation", "vertical");
    await userEvent.click(within(rail).getByRole("tab", { name: "Billing" }));
    expect(within(drawer).getByText("Bill #10102")).toBeVisible();
    expect(within(drawer).getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("calls onOpenChange(false) from the close button", async () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange} title="Patient" sections={sections.slice(0, 1)} />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("Menu and KebabMenu", () => {
  it("opens from the kebab, runs an item and skips disabled ones", async () => {
    const edit = vi.fn();
    const remove = vi.fn();
    render(
      <KebabMenu
        label="Actions for #OS12KOS"
        items={[
          { label: "Edit", icon: PencilSimple, onSelect: edit },
          { label: "Delete", icon: Trash, onSelect: remove, danger: true, disabled: true },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for #OS12KOS" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    expect(edit).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from the keyboard", async () => {
    render(
      <Menu trigger={<Button>More</Button>} items={[{ label: "Print", onSelect: vi.fn() }]} />,
    );
    screen.getByRole("button", { name: "More" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "Print" })).toBeInTheDocument();
  });
});

describe("Toast", () => {
  afterEach(() => vi.useRealTimers());

  function Saver() {
    const toast = useToast();
    return (
      <>
        <Button onClick={() => toast({ title: "Patient saved" })}>Save</Button>
        <Button onClick={() => toast({ title: "Save failed", tone: "error" })}>Fail</Button>
      </>
    );
  }

  it("shows a success toast that leaves after 4 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider>
        <Saver />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Patient saved")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(TOAST_DURATION + 500);
    });
    expect(screen.queryByText("Patient saved")).toBeNull();
  });

  it("keeps errors until dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider>
        <Saver />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    await act(async () => {
      vi.advanceTimersByTime(TOAST_DURATION * 3);
    });
    expect(screen.getByText("Save failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Save failed")).toBeNull();
  });

  it("refuses to work outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Saver />)).toThrow("useToast must be used inside ToastProvider");
  });
});

describe("Tooltip", () => {
  it("appears on keyboard focus", async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Last synced 2 minutes ago">
          <button type="button">Sync</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Sync" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Last synced 2 minutes ago");
  });
});
