import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { greetingFor, PageGreeting } from "./page-container";
import { TopBar } from "./top-bar";

const navigation = vi.hoisted(() => ({ pathname: "/patients", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

const facility = {
  facilities: [
    { id: "f1", name: "Main Clinic", code: "MAIN" },
    { id: "f2", name: "Annex", code: "ANX" },
  ],
  current: { id: "f1", name: "Main Clinic", code: "MAIN" },
  onSelect: vi.fn(),
};

function renderShell(roles: string[] = ["front_desk"]) {
  return render(
    <AppShell user={{ name: "Ada Tester", roles }} facility={facility} onSignOut={vi.fn()}>
      <p>Page content</p>
    </AppShell>,
  );
}

function mainNav() {
  // The sidebar is rendered once for wide screens; the drawer copy only exists when open.
  return screen.getByRole("navigation", { name: "Main" });
}

beforeEach(() => {
  navigation.pathname = "/patients";
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("marks the current page in the sidebar and names it in the top bar", () => {
    navigation.pathname = "/patients/123";
    renderShell();
    const current = within(mainNav()).getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Patients");
    expect(current).toHaveAttribute("href", "/patients");
    expect(screen.getByRole("banner")).toHaveTextContent("Patients");
  });

  it("shows only the screens for the user's roles", () => {
    renderShell(["compliance_officer"]);
    const links = within(mainNav())
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links).toEqual(["Dashboard", "Break-glass review", "Audit log"]);
  });

  it("collapses to an icon rail and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Labels stay available to screen readers in the rail.
    expect(within(mainNav()).getByRole("link", { name: "Patients" })).toBeInTheDocument();
    expect(window.localStorage.getItem("emr.sidebar.collapsed")).toBe("1");

    unmount();
    renderShell();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("still collapses when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("starts with a skip link to the content", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("opens the menu drawer on small screens", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(within(drawer).getByRole("link", { name: "Patients" })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the current facility", () => {
    renderShell();
    expect(
      screen.getByRole("button", { name: "Facility: Main Clinic. Change facility" }),
    ).toBeInTheDocument();
  });
});

describe("TopBar", () => {
  const props = {
    title: "Patients",
    user: { name: "Ada Tester", role: "Front desk" },
    quickCreate: [{ label: "New patient", href: "/patients/new", roles: [] }],
    onSignOut: vi.fn(),
    onOpenNav: vi.fn(),
  };

  it("searches patients from the search pill", async () => {
    const user = userEvent.setup();
    render(<TopBar {...props} />);
    await user.type(screen.getByRole("searchbox"), "Okafor{Enter}");
    expect(navigation.push).toHaveBeenCalledWith("/patients?search=Okafor");
  });

  it("focuses the search with Ctrl K", async () => {
    const user = userEvent.setup();
    render(<TopBar {...props} />);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("hides the + button when there is nothing to create", () => {
    render(<TopBar {...props} quickCreate={[]} />);
    expect(screen.queryByRole("button", { name: "Create new" })).not.toBeInTheDocument();
  });

  it("shows setup progress until setup is complete", () => {
    const { rerender } = render(<TopBar {...props} setup={{ done: 1, total: 4 }} />);
    expect(screen.getByLabelText("Setup: 1 of 4 steps done")).toHaveTextContent("1/4");
    rerender(<TopBar {...props} setup={{ done: 4, total: 4 }} />);
    expect(screen.queryByLabelText(/Setup:/)).not.toBeInTheDocument();
  });

  it("shows who is signed in", () => {
    render(<TopBar {...props} />);
    expect(screen.getByTestId("signed-in-user")).toHaveTextContent("Ada Tester");
    expect(screen.getByRole("button", { name: "Account: Ada Tester" })).toHaveTextContent(
      "Front desk",
    );
  });
});

describe("PageGreeting", () => {
  it("greets by time of day with the date", () => {
    render(<PageGreeting name="Ada" now={new Date(2026, 9, 16, 9, 0)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning, Ada!");
    expect(screen.getByText("Friday, 16 October 2026")).toBeInTheDocument();
  });

  it("changes greeting through the day", () => {
    expect(greetingFor(new Date(2026, 9, 16, 13))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 9, 16, 19))).toBe("Good evening");
  });
});
