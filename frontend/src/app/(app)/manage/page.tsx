"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Dialog, Field, Loading, NoAccess, Notice, Select } from "@/components/legacy-ui";
import { api, apiError, fieldErrors, type Schemas } from "@/lib/api";
import { humanise } from "@/lib/format";

type User = Schemas["User"];
type Assignment = Schemas["RoleAssignment"];

const ROLES = [
  "tenant_admin",
  "doctor",
  "nurse",
  "pharmacist",
  "lab_technician",
  "front_desk",
  "billing_officer",
  "finance",
  "hr",
  "compliance_officer",
  "patient",
];

/** Users of the organisation and their roles. Tenant admins manage them. */
export default function ManageUsersPage() {
  const [users, setUsers] = useState<User[] | "forbidden" | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [facilities, setFacilities] = useState<Schemas["Facility"][]>([]);
  const [departments, setDepartments] = useState<Schemas["Department"][]>([]);
  const [inviting, setInviting] = useState(false);
  const [assigning, setAssigning] = useState<User | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function load() {
    const [u, a, f, d] = await Promise.all([
      api.GET("/api/accounts/users/"),
      api.GET("/api/accounts/role-assignments/"),
      api.GET("/api/tenants/facilities/"),
      api.GET("/api/tenants/departments/"),
    ]);
    if (u.response.status === 403) return setUsers("forbidden");
    setUsers(u.data?.results ?? []);
    setAssignments(a.data?.results ?? []);
    setFacilities(f.data?.results ?? []);
    setDepartments(d.data?.results ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const scope = (a: Assignment) => {
    const department = departments.find((d) => d.id === a.department);
    const facility = facilities.find((f) => f.id === a.facility);
    return department ? department.name : facility ? facility.name : "whole organisation";
  };

  async function removeRole(a: Assignment) {
    const { error } = await api.DELETE("/api/accounts/role-assignments/{id}/", {
      params: { path: { id: a.id } },
    });
    setMessage(
      error
        ? { tone: "error", text: apiError(error).message }
        : { tone: "success", text: "Role removed." },
    );
    load();
  }

  async function deactivate(user: User) {
    if (!window.confirm(`Deactivate ${user.username}? They will be signed out everywhere.`)) return;
    const { error } = await api.POST("/api/accounts/users/{id}/deactivate/", {
      params: { path: { id: user.id } },
    });
    setMessage(
      error
        ? { tone: "error", text: apiError(error).message }
        : { tone: "success", text: `${user.username} deactivated.` },
    );
    load();
  }

  if (users === null) return <Loading />;
  if (users === "forbidden") return <NoAccess />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Users and roles</h1>
        <div className="flex gap-3">
          <Link href="/manage/staff" className="self-center text-teal-800 underline">
            Staff and licences
          </Link>
          <Button onClick={() => setInviting(true)}>Invite user</Button>
        </div>
      </div>
      <div aria-live="polite">{message && <Notice tone={message.tone} title={message.text} />}</div>
      <ul className="flex flex-col gap-3">
        {users.map((user) => {
          const own = assignments.filter((a) => a.user === user.id);
          return (
            <li
              key={user.id}
              data-testid="user"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">
                  {[user.first_name, user.last_name].filter(Boolean).join(" ") || user.username}
                </span>
                <span className="font-mono text-xs text-slate-600">{user.username}</span>
                {!user.is_active && (
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold">
                    Deactivated
                  </span>
                )}
                <span className="ml-auto flex gap-2">
                  {user.is_active && (
                    <Button variant="secondary" onClick={() => setAssigning(user)}>
                      Add role
                    </Button>
                  )}
                  {user.is_active && (
                    <Button variant="secondary" onClick={() => deactivate(user)}>
                      Deactivate
                    </Button>
                  )}
                </span>
              </div>
              {own.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {own.map((a) => (
                    <li
                      key={a.id}
                      data-testid="role"
                      className="flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-sm text-teal-900"
                    >
                      {humanise(a.role)} · {scope(a)}
                      <button
                        type="button"
                        onClick={() => removeRole(a)}
                        aria-label={`Remove ${humanise(a.role)} from ${user.username}`}
                        className="ml-1 rounded px-1 font-bold hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onDone={(username) => {
          setInviting(false);
          setMessage({
            tone: "success",
            text: `${username} invited. They will get an email to set a password.`,
          });
          load();
        }}
      />
      <RoleDialog
        user={assigning}
        facilities={facilities}
        departments={departments}
        onClose={() => setAssigning(null)}
        onDone={() => {
          setAssigning(null);
          setMessage({ tone: "success", text: "Role added." });
          load();
        }}
      />
    </div>
  );
}

function InviteDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (username: string) => void;
}) {
  const blank = { username: "", email: "", first_name: "", last_name: "" };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(blank);
      setErrors({});
      setFailure(null);
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { error } = await api.POST("/api/accounts/users/", { body: form });
    if (error) {
      const problem = apiError(error);
      setErrors(fieldErrors(problem));
      return setFailure(problem.code === "validation_error" ? null : problem.message);
    }
    onDone(form.username);
  }

  return (
    <Dialog open={open} title="Invite user" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {failure && <Notice tone="error" title={failure} />}
        <Field
          label="Username"
          required
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          error={errors.username}
        />
        <Field
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.email}
          hint="The invitation to set a password goes here."
        />
        <Field
          label="First name"
          value={form.first_name}
          onChange={(e) => setForm({ ...form, first_name: e.target.value })}
        />
        <Field
          label="Last name"
          value={form.last_name}
          onChange={(e) => setForm({ ...form, last_name: e.target.value })}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Send invitation</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RoleDialog({
  user,
  facilities,
  departments,
  onClose,
  onDone,
}: {
  user: User | null;
  facilities: Schemas["Facility"][];
  departments: Schemas["Department"][];
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState("doctor");
  const [facility, setFacility] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRole("doctor");
    setFacility("");
    setDepartment("");
    setError(null);
  }, [user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    const { error: failure } = await api.POST("/api/accounts/role-assignments/", {
      body: {
        user: user.id,
        role: role as Schemas["RoleEnum"],
        facility: facility || null,
        department: department || null,
      },
    });
    if (failure) {
      const problem = apiError(failure);
      const first = Object.values(fieldErrors(problem))[0];
      return setError(first ?? problem.message);
    }
    onDone();
  }

  return (
    <Dialog open={user !== null} title={`Add role for ${user?.username ?? ""}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Notice tone="error" title={error} />}
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {humanise(r)}
            </option>
          ))}
        </Select>
        <Select
          label="Limited to facility"
          value={facility}
          onChange={(e) => {
            setFacility(e.target.value);
            setDepartment("");
          }}
        >
          <option value="">Whole organisation</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select
          label="Limited to department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">Whole facility</option>
          {departments
            .filter((d) => !facility || d.facility === facility)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </Select>
        <p className="text-sm text-slate-600">
          Access is narrowed by these limits for every action the role allows.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add role</Button>
        </div>
      </form>
    </Dialog>
  );
}
