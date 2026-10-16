"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Dialog, Field, Loading, NoAccess, Notice, Select } from "@/components/legacy-ui";
import { api, apiError, fieldErrors, type Schemas } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, humanise, toMinor } from "@/lib/format";

type Profile = Schemas["StaffProfile"];

const STAFF_TYPES = [
  "physician",
  "nurse",
  "pharmacist",
  "lab_scientist",
  "radiographer",
  "other_clinical",
  "non_clinical",
];
const BODIES: [string, string][] = [
  ["mdcn", "MDCN (doctors)"],
  ["nmcn", "NMCN (nurses and midwives)"],
  ["pcn", "PCN (pharmacists)"],
  ["mlscn", "MLSCN (lab scientists)"],
  ["rrbn", "RRBN (radiographers)"],
  ["other", "Other"],
];
const FLAG_STYLE: Record<string, string> = {
  expired: "bg-red-100 text-red-900",
  expiring: "bg-amber-100 text-amber-900",
  ok: "bg-emerald-50 text-emerald-900",
};

/** Staff profiles and licences. HR and tenant admins maintain them and record checks. */
export default function StaffPage() {
  const [profiles, setProfiles] = useState<Profile[] | "forbidden" | null>(null);
  const [users, setUsers] = useState<Schemas["User"][]>([]);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [p, u] = await Promise.all([
      api.GET("/api/staff/profiles/"),
      api.GET("/api/accounts/users/"),
    ]);
    setProfiles(p.response.status === 403 ? "forbidden" : (p.data?.results ?? []));
    setUsers(u.data?.results ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  if (profiles === null) return <Loading />;
  if (profiles === "forbidden") return <NoAccess />;
  const withoutProfile = users.filter((u) => u.is_active && !profiles.some((p) => p.user === u.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Staff and licences</h1>
        <Button onClick={() => setCreating(true)} disabled={withoutProfile.length === 0}>
          Add staff profile
        </Button>
      </div>
      <div aria-live="polite">{message && <Notice tone="success" title={message} />}</div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Staff profiles</caption>
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th scope="col" className="p-3">
                Name
              </th>
              <th scope="col" className="p-3">
                Type
              </th>
              <th scope="col" className="p-3">
                Licence
              </th>
              <th scope="col" className="p-3">
                Expires
              </th>
              <th scope="col" className="p-3">
                Checked
              </th>
              <th scope="col" className="p-3">
                On duty
              </th>
              <th scope="col" className="p-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} data-testid="staff-profile" className="border-t border-slate-100">
                <td className="p-3 font-medium">{p.display_name}</td>
                <td className="p-3">{humanise(p.staff_type)}</td>
                <td className="p-3 font-mono text-xs">{p.licence_number || "—"}</td>
                <td className="p-3">
                  {formatDate(p.licence_expires_on)}{" "}
                  {p.licence_expires_on && (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${FLAG_STYLE[p.licence_flag] ?? ""}`}
                    >
                      {humanise(p.licence_flag)}
                    </span>
                  )}
                </td>
                <td className="p-3" data-testid="verification">
                  {humanise(p.licence_verification)}
                  {p.licence_verified_at ? ` ${formatDateTime(p.licence_verified_at)}` : ""}
                </td>
                <td className="p-3">{p.on_duty ? "On duty" : "Off duty"}</td>
                <td className="p-3">
                  {p.licence_number && p.licence_verification === "unverified" && (
                    <Button variant="secondary" onClick={() => setVerifying(p)}>
                      Record check
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ProfileDialog
        open={creating}
        users={withoutProfile}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          setMessage("Staff profile added.");
          load();
        }}
      />
      <VerifyDialog
        profile={verifying}
        onClose={() => setVerifying(null)}
        onDone={() => {
          setVerifying(null);
          setMessage("Licence check recorded.");
          load();
        }}
      />
    </div>
  );
}

function ProfileDialog({
  open,
  users,
  onClose,
  onDone,
}: {
  open: boolean;
  users: Schemas["User"][];
  onClose: () => void;
  onDone: () => void;
}) {
  const blank = {
    user: "",
    staff_type: "nurse",
    title: "",
    specialty: "",
    licensing_body: "nmcn",
    licence_number: "",
    licence_expires_on: "",
    fee: "0",
  };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setForm({ ...blank, user: users[0]?.id ?? "" });
    else setErrors({});
  }, [open]);

  const clinical = form.staff_type !== "non_clinical";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fee = toMinor(form.fee);
    if (fee === null)
      return setErrors({ consultation_fee_minor: "Enter an amount such as 15000." });
    const { error } = await api.POST("/api/staff/profiles/", {
      body: {
        user: form.user,
        staff_type: form.staff_type as Schemas["StaffTypeEnum"],
        title: form.title,
        specialty: form.specialty,
        licensing_body: (clinical ? form.licensing_body : "") as Schemas["LicensingBodyEnum"],
        licence_number: clinical ? form.licence_number : "",
        licence_expires_on: clinical && form.licence_expires_on ? form.licence_expires_on : null,
        consultation_fee_minor: fee,
      },
    });
    if (error) return setErrors(fieldErrors(apiError(error)));
    onDone();
  }

  return (
    <Dialog open={open} title="Add staff profile" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Select
          label="User"
          value={form.user}
          onChange={(e) => setForm({ ...form, user: e.target.value })}
          error={errors.user}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.username}
            </option>
          ))}
        </Select>
        <Select
          label="Staff type"
          value={form.staff_type}
          onChange={(e) => setForm({ ...form, staff_type: e.target.value })}
        >
          {STAFF_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanise(t)}
            </option>
          ))}
        </Select>
        <Field
          label="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          hint="For example Dr"
        />
        {clinical && (
          <>
            <Select
              label="Licensing council"
              value={form.licensing_body}
              onChange={(e) => setForm({ ...form, licensing_body: e.target.value })}
              error={errors.licensing_body}
            >
              {BODIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Field
              label="Licence number"
              required
              value={form.licence_number}
              onChange={(e) => setForm({ ...form, licence_number: e.target.value })}
              error={errors.licence_number}
            />
            <Field
              label="Licence expires"
              type="date"
              required
              value={form.licence_expires_on}
              onChange={(e) => setForm({ ...form, licence_expires_on: e.target.value })}
              error={errors.licence_expires_on}
            />
          </>
        )}
        <Field
          label={`Consultation fee (₦)${form.staff_type === "physician" ? "" : ", if any"}`}
          inputMode="decimal"
          value={form.fee}
          onChange={(e) => setForm({ ...form, fee: e.target.value })}
          error={errors.consultation_fee_minor}
        />
        {errors.non_field_errors && <Notice tone="error" title={errors.non_field_errors} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!form.user}>
            Add profile
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function VerifyDialog({
  profile,
  onClose,
  onDone,
}: {
  profile: Profile | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState("verified");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOutcome("verified");
    setReference("");
    setError(null);
  }, [profile]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    const { error: failure } = await api.POST("/api/staff/profiles/{id}/verify-licence/", {
      params: { path: { id: profile.id } },
      body: { outcome: outcome as Schemas["LicenceVerificationOutcomeEnum"], reference },
    });
    if (failure) return setError(apiError(failure).message);
    onDone();
  }

  return (
    <Dialog
      open={profile !== null}
      title={`Licence check: ${profile?.display_name ?? ""}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Notice tone="error" title={error} />}
        <p className="text-sm text-slate-700">
          Look up {profile?.licence_number} on the council&apos;s register, then record what you
          found.
          {profile &&
            ` Consultation fee: ${formatMoney(profile.consultation_fee_minor ?? 0, profile.consultation_fee_currency ?? "NGN")}.`}
        </p>
        <Select label="Result" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="verified">Found on the register</option>
          <option value="rejected">Not found on the register</option>
        </Select>
        <Field
          label="Register reference"
          required
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          hint="For example the register search date and entry number."
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!reference.trim()}>
            Record check
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
