"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Button, Field, Notice, Select } from "@/components/ui";
import { api, apiError, fieldErrors, type Schemas } from "@/lib/api";

type Candidate = { patient_id: string; mrn: string; score: number };
type Held = { reviewId: string; candidates: Candidate[] };

const EMPTY: Schemas["PatientRequest"] = {
  first_name: "",
  middle_name: "",
  last_name: "",
  date_of_birth: "",
  sex: "unknown",
  phone: "",
  national_id: "",
  email: "",
};

/** Registration. A likely duplicate is held for review by the API (409), not created. */
export default function RegisterPatientPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<Held | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const warningRef = useRef<HTMLDivElement>(null);

  const set = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(null);
    setHeld(null);
    const { data, error, response } = await api.POST("/api/patients/patients/", { body: form });
    setBusy(false);
    if (data) {
      router.push(`/patients/${data.id}`);
      return;
    }
    const problem = apiError(error);
    if (response.status === 409 && problem.code === "possible_duplicate") {
      setHeld({
        reviewId: String(problem.details.review_id),
        candidates: problem.details.candidates as Candidate[],
      });
      requestAnimationFrame(() => warningRef.current?.focus());
      return;
    }
    if (response.status === 403) return setFailure("You do not have permission to register patients.");
    setErrors(fieldErrors(problem));
    if (problem.code !== "validation_error") setFailure(problem.message);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Register patient</h1>
      {held && (
        <div ref={warningRef} tabIndex={-1} className="focus:outline-none">
          <Notice tone="warning" title="This person may already be registered">
            <p>
              The registration has not been created. It is held for review (reference{" "}
              <span className="font-mono">{held.reviewId.slice(0, 8)}</span>) so a colleague can
              confirm whether this is a new patient.
            </p>
            <p className="mt-2">Possible matches:</p>
            <ul className="mt-1 list-disc pl-5">
              {held.candidates.map((c) => (
                <li key={c.patient_id}>
                  <Link href={`/patients/${c.patient_id}`} className="underline">
                    MRN {c.mrn}
                  </Link>{" "}
                  ({Math.round(c.score * 100)}% match)
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {failure && <Notice tone="error" title={failure} />}
      <form onSubmit={submit} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2" noValidate>
        <Field label="First name" required value={form.first_name} onChange={set("first_name")} error={errors.first_name} autoComplete="off" />
        <Field label="Last name" required value={form.last_name} onChange={set("last_name")} error={errors.last_name} autoComplete="off" />
        <Field label="Middle name" value={form.middle_name} onChange={set("middle_name")} error={errors.middle_name} autoComplete="off" />
        <Field label="Date of birth" type="date" required value={form.date_of_birth} onChange={set("date_of_birth")} error={errors.date_of_birth} />
        <Select label="Sex" value={form.sex} onChange={set("sex")} error={errors.sex}>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
          <option value="unknown">Unknown</option>
        </Select>
        <Field label="Phone" type="tel" value={form.phone} onChange={set("phone")} error={errors.phone} hint="Local numbers such as 0803… are accepted." />
        <Field label="National ID (NIN)" value={form.national_id} onChange={set("national_id")} error={errors.national_id} hint="Optional" />
        <Field label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} hint="Optional" />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Registering…" : "Register"}
          </Button>
        </div>
      </form>
    </div>
  );
}
