"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

/** A patient's name, linked to the chart. Shows "Patient" if the viewer may not read it. */
export function PatientName({ id, link = true }: { id: string; link?: boolean }) {
  const [name, setName] = useState("…");
  useEffect(() => {
    api.GET("/api/patients/patients/{id}/", { params: { path: { id } } }).then(({ data }) =>
      setName(data ? `${data.first_name} ${data.last_name} (${data.mrn})` : "Patient"),
    );
  }, [id]);
  return link ? (
    <Link href={`/patients/${id}`} className="text-teal-800 underline">
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}
