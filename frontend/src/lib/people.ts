import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiError, fieldErrors, type Schemas, unwrap } from "@/lib/api";

/**
 * Inviting people (apps/accounts). An invitation needs an email address and a role. The person
 * signs in with that email address, and the role decides what they can do; the list of what each
 * role may do comes from the server's live permission rules, so it is always the truth.
 */
export type RoleInfo = Schemas["RoleInfo"];
export type PermissionLine = Schemas["PermissionLine"];
export type InviteBody = Schemas["UserRequest"];

export function useRoleCatalogue(enabled = true) {
  return useQuery({
    queryKey: ["accounts", "roles"],
    queryFn: () => unwrap(api.GET("/api/accounts/users/roles/")),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteBody) => unwrap(api.POST("/api/accounts/users/", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { quietErrors: true },
  });
}

export type InviteForm = { first_name: string; last_name: string; email: string; role: string };

export type InviteErrors = Partial<Record<keyof InviteForm, string>>;

/** What is wrong with the form before anything is sent. */
export function checkInvite(form: InviteForm): InviteErrors {
  const errors: InviteErrors = {};
  if (!form.first_name.trim()) errors.first_name = "Enter their first name.";
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = "Enter a valid email address.";
  if (!form.role) errors.role = "Choose their role.";
  return errors;
}

/** Field errors and a sentence for a refused invitation. */
export function inviteProblem(failure: unknown): { fields: InviteErrors; message: string | null } {
  const problem = apiError(failure);
  const fields = fieldErrors(problem) as InviteErrors;
  const first = Object.values(fields)[0];
  return {
    fields,
    message: first ? null : problem.message,
  };
}

/** "View, Add and Change": the actions of one line as a sentence. */
export function actionsText(actions: readonly string[]): string {
  if (actions.length <= 1) return actions[0] ?? "";
  return `${actions.slice(0, -1).join(", ")} and ${actions[actions.length - 1]}`;
}

/** The small print after the actions: where it applies and when. */
export function limitText(line: Pick<PermissionLine, "limit" | "on_duty_only">): string {
  const parts = [line.limit, line.on_duty_only ? "while on duty" : ""].filter(Boolean);
  return parts.join(", ");
}

/** True when the role can only look: nothing it may do changes any record. */
export function isReadOnly(role: Pick<RoleInfo, "permissions">): boolean {
  return role.permissions.every((p) => p.actions.every((a) => a === "View"));
}
