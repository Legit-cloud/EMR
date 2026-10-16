"use client";

import { useEffect, useRef, useState } from "react";

import { Loading, NoAccess, Select } from "@/components/ui";
import { api, type Schemas } from "@/lib/api";
import { formatTime, humanise } from "@/lib/format";
import { useMe } from "@/lib/session";

type Entry = Schemas["QueueEntry"];
type Connection = "connecting" | "live" | "reconnecting" | "refused";

/**
 * The physician's waiting queue, updated live over a WebSocket. The server sends only
 * patients inside the viewer's access scope; most urgent first, then by arrival.
 */
export default function QueuePage() {
  const me = useMe();
  const [physicians, setPhysicians] = useState<Schemas["StaffProfile"][] | "forbidden" | null>(null);
  const [physician, setPhysician] = useState("");
  const [queue, setQueue] = useState<Entry[] | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [announcement, setAnnouncement] = useState("");
  const retry = useRef(0);

  useEffect(() => {
    api.GET("/api/staff/profiles/", { params: { query: { staff_type: "physician" } } }).then(({ data, response }) => {
      if (response.status === 403) return setPhysicians("forbidden");
      const list = data?.results ?? [];
      setPhysicians(list);
      const own = list.find((p) => p.user === me.id);
      setPhysician(own?.user ?? list[0]?.user ?? "");
    });
  }, [me.id]);

  useEffect(() => {
    if (!physician) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    // A first load over HTTP, so the page is useful even before the socket connects.
    api.GET("/api/scheduling/appointments/queue/", { params: { query: { physician } } }).then(({ data }) => {
      if (data && !stopped) setQueue(data);
    });

    function connect() {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/ws/queue/${physician}/`);
      socket.onopen = () => {
        retry.current = 0;
        setConnection("live");
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as { type: string; queue: Entry[] };
        if (message.type !== "queue") return;
        setQueue(message.queue);
        setAnnouncement(`Queue updated: ${message.queue.length} waiting.`);
      };
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === 4401 || event.code === 4403) return setConnection("refused");
        setConnection("reconnecting");
        retry.current += 1;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry.current));
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [physician]);

  if (physicians === null) return <Loading />;
  if (physicians === "forbidden") return <NoAccess />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Waiting queue</h1>
        <p className="text-sm" data-testid="connection">
          <span
            aria-hidden
            className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${connection === "live" ? "bg-emerald-600" : connection === "refused" ? "bg-red-600" : "bg-amber-500"}`}
          />
          {{ connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", refused: "Live updates not allowed" }[connection]}
        </p>
      </div>
      <div className="max-w-sm">
        <Select label="Physician" value={physician} onChange={(e) => setPhysician(e.target.value)}>
          {physicians.map((p) => (
            <option key={p.id} value={p.user}>
              {p.display_name}
            </option>
          ))}
        </Select>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {queue === null ? (
        <Loading />
      ) : queue.length === 0 ? (
        <p className="text-slate-600">Nobody is waiting.</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Patients waiting, in order">
          {queue.map((entry, index) => (
            <li
              key={entry.appointment_id}
              data-testid="queue-entry"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <span className="w-6 text-right font-semibold text-slate-500">{index + 1}</span>
              <span className="font-medium">{entry.patient_name}</span>
              <span className="font-mono text-xs text-slate-600">{entry.mrn}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${entry.triage_priority === 1 ? "bg-red-100 text-red-900" : "bg-slate-100 text-slate-800"}`}
              >
                Priority {entry.triage_priority ?? "—"}
              </span>
              <span className="text-sm text-slate-700">
                {humanise(entry.appointment_type)}, arrived {formatTime(entry.checked_in_at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
