"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Field, Loading, NoAccess } from "@/components/ui";
import { api, type Schemas } from "@/lib/api";
import { formatDate } from "@/lib/format";

export default function PatientsPage() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Schemas["Patient"][] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const { data, response } = await api.GET("/api/patients/patients/", {
        params: { query: query ? { q: query } : {} },
      });
      setForbidden(response.status === 403);
      setPatients(data?.results ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <Link
          href="/patients/new"
          className="min-h-11 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Register patient
        </Link>
      </div>
      <div className="max-w-md">
        <Field
          label="Search by name, MRN or phone"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {forbidden ? (
        <NoAccess />
      ) : patients === null ? (
        <Loading />
      ) : patients.length === 0 ? (
        <p className="text-slate-600">No patients found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Patients</caption>
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th scope="col" className="p-3">MRN</th>
                <th scope="col" className="p-3">Name</th>
                <th scope="col" className="p-3">Date of birth</th>
                <th scope="col" className="p-3">Phone</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono">{p.mrn}</td>
                  <td className="p-3">
                    <Link href={`/patients/${p.id}`} className="text-teal-800 underline">
                      {p.first_name} {p.last_name}
                    </Link>
                  </td>
                  <td className="p-3">{formatDate(p.date_of_birth)}</td>
                  <td className="p-3">{p.phone || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
