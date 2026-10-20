"use client";

import { useEffect, useReducer, useState } from "react";

import { api, type Schemas } from "./api";

export type QueueEntry = Schemas["QueueEntry"];
export type Connection = "connecting" | "live" | "reconnecting" | "refused";

/** The server closes with these codes when the viewer may not watch this queue. */
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
/** How long a new arrival stays highlighted. */
export const HIGHLIGHT_MS = 4000;

/** Wait before reconnect attempt number `attempt` (1, 2, ...): 2 s, 4 s, ... up to 30 s. */
export const backoffDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

export function queueSocketUrl(physician: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws/queue/${physician}/`;
}

type State = {
  /** null until the first load. */
  rows: QueueEntry[] | null;
  /** Appointment ids that arrived in the last update, highlighted for a moment. */
  fresh: string[];
  /** For the aria-live region. */
  announcement: string;
  connection: Connection;
  loadFailed: boolean;
};

type Action =
  | { type: "rows"; rows: QueueEntry[] }
  | { type: "settle" }
  | { type: "connection"; connection: Connection }
  | { type: "load_failed" };

const sameRows = (a: QueueEntry[], b: QueueEntry[]) =>
  a.length === b.length &&
  a.every(
    (row, i) =>
      row.appointment_id === b[i].appointment_id && row.triage_priority === b[i].triage_priority,
  );

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.connection };
    case "settle":
      return { ...state, fresh: [] };
    case "load_failed":
      return state.rows === null ? { ...state, loadFailed: true } : state;
    case "rows": {
      const rows = action.rows;
      if (state.rows === null) {
        return {
          ...state,
          rows,
          loadFailed: false,
          announcement: `${rows.length} waiting.`,
        };
      }
      if (sameRows(state.rows, rows)) return { ...state, rows, loadFailed: false };
      const known = new Set(state.rows.map((r) => r.appointment_id));
      const arrivals = rows.filter((r) => !known.has(r.appointment_id));
      const announcement = arrivals.length
        ? `${arrivals.map((r) => r.patient_name).join(", ")} checked in. ${rows.length} waiting.`
        : `Queue updated: ${rows.length} waiting.`;
      return {
        ...state,
        rows,
        loadFailed: false,
        fresh: arrivals.map((r) => r.appointment_id),
        announcement,
      };
    }
  }
}

const initial: State = {
  rows: null,
  fresh: [],
  announcement: "",
  connection: "connecting",
  loadFailed: false,
};

/**
 * One physician's waiting queue: a first load over HTTP, then live updates over the Channels
 * WebSocket with automatic reconnecting. The server only sends patients inside the viewer's
 * access scope. Mount it with `key={physician}` so a change of physician starts fresh.
 */
export function useLiveQueue(physician: string) {
  const [state, dispatch] = useReducer(reduce, initial);
  // Bumped by "try again" after a failed first load: the effect below starts over.
  const [attempts, setAttempts] = useState(0);
  const { fresh } = state;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;

    // The page is useful before the socket connects, and again after it drops.
    const load = () =>
      api
        .GET("/api/scheduling/appointments/queue/", { params: { query: { physician } } })
        .then(({ data }) => {
          if (stopped) return;
          if (data) dispatch({ type: "rows", rows: data });
          else dispatch({ type: "load_failed" });
        })
        .catch(() => !stopped && dispatch({ type: "load_failed" }));

    function connect() {
      socket = new WebSocket(queueSocketUrl(physician));
      socket.onopen = () => {
        attempt = 0;
        dispatch({ type: "connection", connection: "live" });
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; queue: QueueEntry[] };
        if (message.type === "queue") dispatch({ type: "rows", rows: message.queue });
      };
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === CLOSE_UNAUTHENTICATED || event.code === CLOSE_FORBIDDEN) {
          return dispatch({ type: "connection", connection: "refused" });
        }
        dispatch({ type: "connection", connection: "reconnecting" });
        attempt += 1;
        // Anything missed while offline is picked up by a fresh load, then the socket resumes.
        void load();
        timer = setTimeout(connect, backoffDelay(attempt));
      };
    }

    void load();
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [physician, attempts]);

  // Highlights fade after a moment.
  useEffect(() => {
    if (fresh.length === 0) return;
    const timer = setTimeout(() => dispatch({ type: "settle" }), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  return { ...state, retry: () => setAttempts((n) => n + 1) };
}
