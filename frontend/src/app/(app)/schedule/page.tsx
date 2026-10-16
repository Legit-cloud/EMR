"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, Dialog, Field, Loading, NoAccess, Notice, Select } from "@/components/legacy-ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatTime, humanise, lagosToday } from "@/lib/format";

type Slot = Schemas["FreeSlot"];
type Appointment = Schemas["Appointment"];

/** Day calendar for one physician: free slots to book and the day's appointments. */
export default function SchedulePage() {
  const [physicians, setPhysicians] = useState<Schemas["StaffProfile"][] | "forbidden" | null>(
    null,
  );
  const [physician, setPhysician] = useState("");
  const [date, setDate] = useState(lagosToday(1));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | "forbidden" | null>(null);
  const [booking, setBooking] = useState<Slot | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api
      .GET("/api/staff/profiles/", { params: { query: { staff_type: "physician" } } })
      .then(({ data, response }) => {
        if (response.status === 403) return setPhysicians("forbidden");
        const list = data?.results ?? [];
        setPhysicians(list);
        if (list.length) setPhysician(list[0].user);
      });
  }, []);

  const refresh = useCallback(async () => {
    if (!physician || !date) return;
    const [free, booked] = await Promise.all([
      api.GET("/api/scheduling/appointments/free-slots/", {
        params: { query: { physician, date } },
      }),
      api.GET("/api/scheduling/appointments/", { params: { query: { physician, date } } }),
    ]);
    setSlots(free.data ?? []);
    setAppointments(booked.response.status === 403 ? "forbidden" : (booked.data?.results ?? []));
  }, [physician, date]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function move(appointment: Appointment, status: "checked_in" | "cancelled") {
    const cancellation_reason =
      status === "cancelled" ? (window.prompt("Reason for cancelling") ?? "").trim() : "";
    if (status === "cancelled" && !cancellation_reason) return;
    const { error } = await api.POST("/api/scheduling/appointments/{id}/status/", {
      params: { path: { id: appointment.id } },
      body: { status, cancellation_reason },
    });
    setMessage(
      error
        ? { tone: "error", text: apiError(error).message }
        : {
            tone: "success",
            text: status === "checked_in" ? "Patient checked in." : "Appointment cancelled.",
          },
    );
    refresh();
  }

  if (physicians === null) return <Loading />;
  if (physicians === "forbidden") return <NoAccess />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Schedule</h1>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Select label="Physician" value={physician} onChange={(e) => setPhysician(e.target.value)}>
          {physicians.map((p) => (
            <option key={p.id} value={p.user}>
              {p.display_name}
            </option>
          ))}
        </Select>
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div aria-live="polite">{message && <Notice tone={message.tone} title={message.text} />}</div>

      <section
        aria-labelledby="free-title"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="free-title" className="mb-3 text-lg font-semibold">
          Free slots
        </h2>
        {slots === null ? (
          <Loading />
        ) : slots.length === 0 ? (
          <p className="text-slate-600">No free slots on this day.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <li key={slot.start_at}>
                <Button
                  variant="secondary"
                  onClick={() => setBooking(slot)}
                  aria-label={`Book ${formatTime(slot.start_at)}`}
                >
                  {formatTime(slot.start_at)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="booked-title"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="booked-title" className="mb-3 text-lg font-semibold">
          Appointments
        </h2>
        {appointments === null ? (
          <Loading />
        ) : appointments === "forbidden" ? (
          <NoAccess />
        ) : appointments.length === 0 ? (
          <p className="text-slate-600">No appointments.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {appointments.map((a) => (
              <li
                key={a.id}
                data-testid="appointment"
                className="flex flex-wrap items-center gap-3 py-2"
              >
                <span className="font-mono">{formatTime(a.start_at)}</span>
                <PatientName id={a.patient} />
                <span
                  className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold"
                  data-testid="appointment-status"
                >
                  {humanise(a.status ?? "booked")}
                </span>
                {(a.status === "booked" || a.status === "confirmed") && (
                  <span className="ml-auto flex gap-2">
                    <Button onClick={() => move(a, "checked_in")}>Check in</Button>
                    <Button variant="secondary" onClick={() => move(a, "cancelled")}>
                      Cancel
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <BookingDialog
        slot={booking}
        physician={physician}
        onClose={() => setBooking(null)}
        onBooked={() => {
          setBooking(null);
          setMessage({
            tone: "success",
            text: "Appointment booked. The patient will get an SMS and email.",
          });
          refresh();
        }}
      />
    </div>
  );
}

function PatientName({ id }: { id: string }) {
  const [name, setName] = useState("…");
  useEffect(() => {
    api
      .GET("/api/patients/patients/{id}/", { params: { path: { id } } })
      .then(({ data }) => setName(data ? `${data.first_name} ${data.last_name}` : "Patient"));
  }, [id]);
  return <span>{name}</span>;
}

function BookingDialog({
  slot,
  physician,
  onClose,
  onBooked,
}: {
  slot: Slot | null;
  physician: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Schemas["Patient"][]>([]);
  const [patient, setPatient] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slot) {
      setQuery("");
      setMatches([]);
      setPatient("");
      setError(null);
    }
  }, [slot]);

  useEffect(() => {
    if (query.length < 2) return setMatches([]);
    const timer = setTimeout(async () => {
      const { data } = await api.GET("/api/patients/patients/", {
        params: { query: { q: query } },
      });
      setMatches(data?.results ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function book() {
    if (!slot || !patient) return;
    const { error: failure } = await api.POST("/api/scheduling/appointments/", {
      body: {
        patient,
        physician,
        facility: slot.facility,
        appointment_type: "new",
        start_at: slot.start_at,
        end_at: slot.end_at,
      },
    });
    if (failure) return setError(apiError(failure).message);
    onBooked();
  }

  return (
    <Dialog
      open={slot !== null}
      title={slot ? `Book ${formatTime(slot.start_at)}` : "Book"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <Field
          label="Find patient"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {matches.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium">Choose the patient</legend>
            <div className="mt-2 flex flex-col gap-1">
              {matches.map((m) => (
                <label
                  key={m.id}
                  className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="patient"
                    value={m.id}
                    checked={patient === m.id}
                    onChange={() => setPatient(m.id)}
                  />
                  {m.first_name} {m.last_name}{" "}
                  <span className="font-mono text-xs text-slate-600">{m.mrn}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={book} disabled={!patient}>
            Book appointment
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
