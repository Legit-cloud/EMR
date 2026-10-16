"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Field, Loading, NoAccess, Notice } from "@/components/legacy-ui";
import { api, apiError, fieldErrors, type Schemas } from "@/lib/api";

/** HMOs and insurers that pay part of patients' bills. */
export default function InsurersPage() {
  const [insurers, setInsurers] = useState<Schemas["Insurer"][] | "forbidden" | null>(null);
  const [form, setForm] = useState({ name: "", code: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function load() {
    const { data, response } = await api.GET("/api/billing/insurers/");
    setInsurers(response.status === 403 ? "forbidden" : (data?.results ?? []));
  }

  useEffect(() => {
    load();
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    const { error } = await api.POST("/api/billing/insurers/", { body: form });
    if (error) {
      const problem = apiError(error);
      setErrors(fieldErrors(problem));
      return setFailure(problem.code === "validation_error" ? null : problem.message);
    }
    setForm({ name: "", code: "" });
    setErrors({});
    setFailure(null);
    load();
  }

  if (insurers === null) return <Loading />;
  if (insurers === "forbidden") return <NoAccess />;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Insurers</h1>
      <Card title="Add insurer">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
          {failure && (
            <div className="sm:col-span-2">
              <Notice tone="error" title={failure} />
            </div>
          )}
          <Field
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
          />
          <Field
            label="Short code"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            error={errors.code}
            hint="Letters, numbers and hyphens"
          />
          <div className="sm:col-span-2">
            <Button type="submit">Add insurer</Button>
          </div>
        </form>
      </Card>
      {insurers.length === 0 ? (
        <p className="text-slate-600">No insurers yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {insurers.map((i) => (
            <li key={i.id} data-testid="insurer" className="flex items-center gap-3 p-3">
              <span className="font-medium">{i.name}</span>
              <span className="font-mono text-xs text-slate-600">{i.code}</span>
              {i.is_active === false && <span className="text-sm text-slate-500">inactive</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
