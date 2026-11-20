import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InviteDialog } from "@/components/people/invite-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { actionsText, checkInvite, isReadOnly, limitText } from "@/lib/people";
import { createQueryClient } from "@/lib/query";
import { resetAuthMocks } from "@/mocks/auth";
import { invited, ROLE_CATALOGUE, resetPeopleMocks } from "@/mocks/people";

vi.setConfig({ testTimeout: 90_000 });

function open(onInvited = vi.fn()) {
  resetAuthMocks("bisi.finance");
  const client = createQueryClient(vi.fn());
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <InviteDialog open onOpenChange={vi.fn()} onInvited={onInvited} />
        </TooltipProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
  return onInvited;
}

beforeEach(resetPeopleMocks);

async function choose(role: string) {
  await userEvent.click(await screen.findByRole("combobox", { name: "Role" }));
  await userEvent.click(await screen.findByRole("option", { name: role }));
}

describe("invite rules", () => {
  it("needs a first name, an email address and a role", () => {
    expect(
      Object.keys(checkInvite({ first_name: "", last_name: "", email: "x", role: "" })),
    ).toEqual(["first_name", "email", "role"]);
    expect(
      checkInvite({ first_name: "Ada", last_name: "", email: "ada@example.test", role: "nurse" }),
    ).toEqual({});
  });

  it("words the actions and limits of a permission", () => {
    expect(actionsText(["View"])).toBe("View");
    expect(actionsText(["View", "Add", "Change"])).toBe("View, Add and Change");
    expect(limitText({ limit: "for patients in their care", on_duty_only: true })).toBe(
      "for patients in their care, while on duty",
    );
    expect(limitText({ limit: "", on_duty_only: false })).toBe("");
  });

  it("knows a role that can only look", () => {
    expect(isReadOnly(ROLE_CATALOGUE[2])).toBe(true);
    expect(isReadOnly(ROLE_CATALOGUE[0])).toBe(false);
  });
});

describe("invite dialog", () => {
  it("has no username: people sign in with their email address", async () => {
    open();
    await screen.findByRole("combobox", { name: "Role" });
    expect(screen.queryByLabelText(/username/i)).toBeNull();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  });

  it("shows what a role can do as soon as it is chosen", async () => {
    open();
    expect(await screen.findByText("Choose a role to see what it can do.")).toBeInTheDocument();
    await choose("Nurse");
    const panel = await screen.findByRole("region", { name: "What Nurse can do" });
    expect(within(panel).getByText("Vital signs")).toBeInTheDocument();
    expect(
      within(panel).getByText(/View and Add, for patients in their care, while on duty/),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/Cares for patients/)).toBeInTheDocument();
  });

  it("changes the list when another role is chosen", async () => {
    open();
    await choose("Doctor");
    expect(await screen.findByText("Prescriptions")).toBeInTheDocument();
    await choose("Nurse");
    expect(await screen.findByRole("region", { name: "What Nurse can do" })).toBeInTheDocument();
    expect(screen.queryByText("Prescriptions")).toBeNull();
  });

  it("says plainly when a role can only look", async () => {
    open();
    await choose("Compliance officer");
    expect(await screen.findByText("This role can only look.")).toBeInTheDocument();
  });

  it("will not send an incomplete form", async () => {
    open();
    await screen.findByRole("combobox", { name: "Role" });
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Enter their first name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Choose their role.")).toBeInTheDocument();
    expect(invited).toHaveLength(0);
  });

  it("sends the invitation with the role and reports the address", async () => {
    const onInvited = open();
    await userEvent.type(screen.getByLabelText("First name"), "Ngozi");
    await userEvent.type(screen.getByLabelText("Email address"), "Ngozi@Example.test");
    await choose("Nurse");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await vi.waitFor(() => expect(onInvited).toHaveBeenCalledWith("ngozi@example.test"));
    expect(invited[0]).toMatchObject({ role: "nurse", first_name: "Ngozi" });
    expect(invited[0]).not.toHaveProperty("username");
  });

  it("shows the server's reason when the email is already in use", async () => {
    open();
    await userEvent.type(screen.getByLabelText("First name"), "Ngozi");
    await userEvent.type(screen.getByLabelText("Email address"), "taken@example.test");
    await choose("Doctor");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(
      await screen.findByText("That email address already belongs to another account."),
    ).toBeInTheDocument();
  });
});
