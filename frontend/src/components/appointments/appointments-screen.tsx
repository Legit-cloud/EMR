"use client";

import {
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CalendarPlus,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KebabMenu } from "@/components/ui/menu";
import { Popover } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  type Appointment,
  conflictMessage,
  type Physician,
  typeLabel,
  useAppointments,
  useHistory,
  usePhysicians,
  useReschedule,
  useWindows,
} from "@/lib/appointments";
import {
  addDays,
  clock,
  dayStartIso,
  formatDayHeading,
  formatLongDate,
  instantAt,
  lagosDateOf,
  minutesOnDay,
  rangeFor,
  visibleHours,
  weekDays,
  weekStart,
} from "@/lib/calendar";
import { formatDateTime, lagosToday } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { APPOINTMENT_STATUS } from "@/lib/status-map";

import { AppointmentDrawer } from "./appointment-drawer";
import { BookingWizard, type BookingStart } from "./booking-wizard";
import { CalendarGrid, type GridColumn } from "./calendar-grid";
import { RescheduleDialog } from "./reschedule-dialog";

type View = "day" | "week" | "list";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  ...(
    [
      "booked",
      "confirmed",
      "checked_in",
      "in_consultation",
      "completed",
      "no_show",
      "cancelled",
    ] as const
  ).map((value) => ({ value, label: APPOINTMENT_STATUS[value].label })),
];

/** Re-renders each minute, so the current-time line moves. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** The appointments screen: Calendar (day, week, list) and Log History. */
export function AppointmentsScreen() {
  const physicians = usePhysicians();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [booking, setBooking] = useState<BookingStart | null>(null);
  const permissions = usePermissions();

  // Everything is found by id from the loaded lists, so the drawer always shows fresh data.
  const [pool, setPool] = useState<Appointment[]>([]);
  const selected = pool.find((a) => a.id === selectedId) ?? null;
  const remember = (rows: Appointment[]) =>
    setPool((current) => {
      const ids = new Set(rows.map((r) => r.id));
      const same =
        current.length >= rows.length &&
        rows.every((r) => current.find((c) => c.id === r.id) === r);
      return same ? current : [...rows, ...current.filter((c) => !ids.has(c.id))];
    });

  if (physicians.error instanceof ApiRequestError && physicians.error.status === 403) {
    return <NoAccess what="the appointments calendar" asPage />;
  }
  if (!physicians.data) {
    return (
      <Loading label="Loading appointments">
        <Skeleton className="rounded-card h-96 w-full" />
      </Loading>
    );
  }

  const doctors = physicians.data;
  const canChange = permissions.hasRole("front_desk", "doctor", "nurse");
  const canBook = permissions.hasRole("front_desk");

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-page-title text-ink-900">Appointments</h1>
        {canBook && (
          <Button className="ml-auto" icon={CalendarPlus} onClick={() => setBooking({})}>
            New appointment
          </Button>
        )}
      </header>

      <Tabs
        label="Appointments"
        items={[
          {
            value: "calendar",
            label: "Calendar",
            content: (
              <CalendarTab
                physicians={doctors}
                canChange={canChange}
                canBook={canBook}
                onOpen={(a) => setSelectedId(a.id)}
                onBook={setBooking}
                onLoaded={remember}
                onViewWeek={() => undefined}
              />
            ),
          },
          {
            value: "history",
            label: "Log History",
            content: (
              <LogHistory
                physicians={doctors}
                onOpen={(a) => setSelectedId(a.id)}
                onLoaded={remember}
              />
            ),
          },
        ]}
      />

      <AppointmentDrawer
        appointment={selected}
        onClose={() => setSelectedId(null)}
        physicians={doctors}
        neighbours={pool}
        canChange={canChange}
        canFinishVisit={permissions.hasRole("doctor")}
        onReschedule={setRescheduling}
      />
      <RescheduleDialog
        appointment={rescheduling}
        physicians={doctors}
        onClose={() => setRescheduling(null)}
      />
      <BookingWizard
        open={booking !== null}
        onOpenChange={(open) => !open && setBooking(null)}
        physicians={doctors}
        initial={booking ?? {}}
      />
    </>
  );
}

// -- calendar --------------------------------------------------------------------------------

type CalendarProps = {
  physicians: Physician[];
  canChange: boolean;
  canBook: boolean;
  onOpen: (appointment: Appointment) => void;
  onBook: (start: BookingStart) => void;
  onLoaded: (rows: Appointment[]) => void;
  onViewWeek: () => void;
};

function CalendarTab({ physicians, canChange, canBook, onOpen, onBook, onLoaded }: CalendarProps) {
  const toast = useToast();
  const now = useNow();
  const today = lagosToday();
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [doctor, setDoctor] = useState("all");
  const [status, setStatus] = useState("all");
  const [showEnded, setShowEnded] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const reschedule = useReschedule();

  // A week is for one physician: with "All doctors" the first one is shown.
  const weekDoctor = doctor === "all" ? (physicians[0]?.user ?? "") : doctor;
  const days = view === "week" ? weekDays(date) : [date];
  const range = view === "week" ? rangeFor(days[0], 7) : rangeFor(date);
  const filterPhysician = view === "week" ? weekDoctor : doctor === "all" ? undefined : doctor;

  const appointments = useAppointments({ ...range, physician: filterPhysician });
  const windows = useWindows({ ...range, physician: filterPhysician }, view !== "list");

  useEffect(() => {
    if (appointments.data) onLoaded(appointments.data as Appointment[]);
  }, [appointments.data, onLoaded]);

  const shown = useMemo(
    () =>
      ((appointments.data ?? []) as Appointment[]).filter(
        (a) =>
          (status === "all" || a.status === status) &&
          (showEnded || status !== "all" || (a.status !== "cancelled" && a.status !== "no_show")),
      ),
    [appointments.data, status, showEnded],
  );
  const name = (id: string) => physicians.find((p) => p.user === id)?.display_name ?? "Doctor";
  const filters = (status !== "all" ? 1 : 0) + (showEnded ? 1 : 0);

  function step(direction: -1 | 1) {
    setDate(addDays(date, direction * (view === "week" ? 7 : 1)));
  }

  async function move(
    appointment: Appointment,
    target: { physicianId: string; date: string; minutes: number },
  ) {
    setConflict(null);
    try {
      await reschedule.mutateAsync({
        id: appointment.id,
        start_at: instantAt(target.date, target.minutes),
        physician: target.physicianId === appointment.physician ? undefined : target.physicianId,
      });
    } catch (failure) {
      return setConflict(conflictMessage(failure, name(target.physicianId)));
    }
    toast({
      title: "Appointment moved",
      description: `${name(target.physicianId)}, ${clock(target.minutes)}`,
      tone: "success",
    });
  }

  // The visible hours: the working day, widened for anything outside it.
  const [startHour, endHour] = visibleHours(date, [
    ...shown.map((a) => ({ start_at: a.start_at, end_at: a.end_at })),
    ...(windows.data ?? []),
  ]);
  const weekHours =
    view === "week" ? weekHoursFor(days, shown, windows.data) : [startHour, endHour];

  const columns: GridColumn[] =
    view === "week"
      ? days.map((day) => ({
          key: day,
          date: day,
          physicianId: weekDoctor,
          header: (
            <span className="flex flex-col">
              <span className="text-body text-ink-900 font-semibold">{formatDayHeading(day)}</span>
              <span className="text-small text-ink-500">
                {count(shown.filter((a) => lagosDateOf(a.start_at) === day))}
              </span>
            </span>
          ),
          windows: windows.data?.filter((w) => w.physician === weekDoctor),
          appointments: shown.filter((a) => lagosDateOf(a.start_at) === day),
        }))
      : physicians
          .filter((p) => doctor === "all" || p.user === doctor)
          .map((p) => {
            const own = shown.filter((a) => a.physician === p.user);
            return {
              key: p.user,
              date,
              physicianId: p.user,
              header: (
                <span className="flex w-full items-center gap-2">
                  <Avatar name={p.display_name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink-900 truncate font-semibold">
                      {p.display_name}
                    </span>
                    <span className="text-small text-ink-500 truncate">
                      {date === today ? "Today's appointment: " : "Appointments: "}
                      {count(own)}
                    </span>
                  </span>
                  <KebabMenu
                    label={`Actions for ${p.display_name}`}
                    items={[
                      ...(canBook
                        ? [
                            {
                              label: "New appointment",
                              onSelect: () => onBook({ physicianId: p.user, date }),
                            },
                          ]
                        : []),
                      {
                        label: "View week",
                        onSelect: () => {
                          setDoctor(p.user);
                          setView("week");
                        },
                      },
                    ]}
                  />
                </span>
              ),
              windows: windows.data?.filter((w) => w.physician === p.user),
              appointments: own,
            };
          });

  const label =
    view === "week"
      ? `${formatDayHeading(days[0])} – ${formatDayHeading(days[6])}, ${days[6].slice(0, 4)}`
      : formatLongDate(date);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="rounded-control bg-blue-100 grid size-11 place-items-center text-blue-600"
          >
            <CalendarBlank size={24} weight="duotone" />
          </span>
          <p className="flex flex-col">
            <span
              className="text-kpi-sm text-ink-900 tnum leading-none"
              data-testid="total-appointments"
            >
              {appointments.data ? shown.length : "–"}
            </span>
            <span className="text-small text-ink-500">total appointments</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="neutral"
            onClick={() => setDate(today)}
            disabled={date === today && view !== "week"}
          >
            Today
          </Button>
          <IconButton
            icon={CaretLeft}
            label={view === "week" ? "Previous week" : "Previous day"}
            onClick={() => step(-1)}
          />
          <IconButton
            icon={CaretRight}
            label={view === "week" ? "Next week" : "Next day"}
            onClick={() => step(1)}
          />
          <h2 className="text-card-title text-ink-900 tnum" aria-live="polite">
            {label}
          </h2>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Calendar view"
            value={view}
            onValueChange={setView}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "list", label: "List" },
            ]}
          />
          <Select
            label="Doctor"
            hideLabel
            value={doctor}
            onValueChange={setDoctor}
            options={[
              { value: "all", label: "All doctors" },
              ...physicians.map((p) => ({ value: p.user, label: p.display_name })),
            ]}
            className="w-48"
          />
          <Popover
            title="Filters"
            trigger={
              <Button variant="neutral" icon={SlidersHorizontal}>
                {filters > 0 ? `Filters (${filters})` : "Filters"}
              </Button>
            }
          >
            <div className="flex flex-col gap-4">
              <Select
                label="Status"
                value={status}
                onValueChange={setStatus}
                options={STATUS_FILTERS}
              />
              <label className="text-body text-ink-900 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={showEnded}
                  onChange={(e) => setShowEnded(e.target.checked)}
                  className="size-4 accent-blue-600"
                />
                Show cancelled and no-show
              </label>
            </div>
          </Popover>
        </div>
      </div>

      {conflict && (
        <Banner
          tone="danger"
          live
          title={conflict}
          action={
            <Button variant="ghost" onClick={() => setConflict(null)}>
              Dismiss
            </Button>
          }
        />
      )}

      {appointments.isError && !appointments.data ? (
        <div role="alert" className="text-body text-ink-600 flex items-center gap-3 py-4">
          Appointments could not be loaded.
          <Button variant="outline" onClick={() => appointments.refetch()}>
            Try again
          </Button>
        </div>
      ) : !appointments.data ? (
        <Loading label="Loading appointments">
          <Skeleton className="rounded-card h-96 w-full" />
        </Loading>
      ) : view === "list" ? (
        <ListView appointments={shown} name={name} onOpen={onOpen} />
      ) : (
        <CalendarGrid
          columns={columns}
          startHour={weekHours[0]}
          endHour={weekHours[1]}
          today={today}
          now={now}
          canDrag={canChange}
          onOpen={onOpen}
          onSlot={(target) => canBook && onBook(target)}
          onMove={move}
        />
      )}
      {view === "week" && doctor === "all" && physicians.length > 1 && (
        <p className="text-small text-ink-500">
          A week shows one physician. Showing {name(weekDoctor)}; choose another above.
        </p>
      )}
    </div>
  );
}

const count = (rows: unknown[]) => `${rows.length} patient${rows.length === 1 ? "" : "s"}`;

/** The hours a week needs: the widest of its days. */
function weekHoursFor(
  days: string[],
  appointments: Appointment[],
  windows: { start_at: string; end_at: string }[] | undefined,
): [number, number] {
  return days.reduce<[number, number]>(
    ([start, end], day) => {
      const [s, e] = visibleHours(day, [
        ...appointments.map((a) => ({ start_at: a.start_at, end_at: a.end_at })),
        ...(windows ?? []),
      ]);
      return [Math.min(start, s), Math.max(end, e)];
    },
    [24, 0],
  );
}

// -- list and history ------------------------------------------------------------------------

function ListView({
  appointments,
  name,
  onOpen,
}: {
  appointments: Appointment[];
  name: (id: string) => string;
  onOpen: (appointment: Appointment) => void;
}) {
  const rows = [...appointments].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return (
    <div className="rounded-card border-line bg-surface shadow-card overflow-hidden border">
      <DataTable
        caption="Appointments"
        columns={appointmentColumns(name, onOpen, false)}
        rows={rows}
        rowId={(a) => a.id}
        empty={<EmptyState title="No appointments in this period." />}
      />
    </div>
  );
}

function appointmentColumns(
  name: (id: string) => string,
  onOpen: (appointment: Appointment) => void,
  withDate: boolean,
): Column<Appointment>[] {
  return [
    {
      id: "time",
      header: withDate ? "Date and time" : "Time",
      cell: (a) => (
        <span className="tnum whitespace-nowrap">
          {withDate
            ? formatDateTime(a.start_at)
            : `${clock(minutesOnDay(a.start_at, lagosDateOf(a.start_at)))}–${clock(minutesOnDay(a.end_at, lagosDateOf(a.start_at)))}`}
        </span>
      ),
    },
    {
      id: "patient",
      header: "Patient",
      cell: (a) => (
        <button
          type="button"
          onClick={() => onOpen(a)}
          className="text-body text-ink-900 text-left font-semibold hover:underline"
        >
          {a.patient_name}
          <span className="text-small text-ink-500 block font-mono font-normal">
            {a.patient_mrn}
          </span>
        </button>
      ),
    },
    { id: "doctor", header: "Physician", cell: (a) => name(a.physician) },
    { id: "service", header: "Service", cell: (a) => typeLabel(a.appointment_type) },
    {
      id: "status",
      header: "Status",
      cell: (a) => <StatusPill status={APPOINTMENT_STATUS[a.status]} />,
    },
  ];
}

function LogHistory({
  physicians,
  onOpen,
  onLoaded,
}: {
  physicians: Physician[];
  onOpen: (appointment: Appointment) => void;
  onLoaded: (rows: Appointment[]) => void;
}) {
  const today = lagosToday();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const history = useHistory({ from: dayStartIso(from), to: dayStartIso(addDays(to, 1)) });
  const name = (id: string) => physicians.find((p) => p.user === id)?.display_name ?? "Doctor";

  useEffect(() => {
    if (history.data) onLoaded(history.data as Appointment[]);
  }, [history.data, onLoaded]);

  const rows = useMemo(
    () =>
      [...((history.data ?? []) as Appointment[])].sort(
        (a, b) => Date.parse(b.start_at) - Date.parse(a.start_at),
      ),
    [history.data],
  );
  const columns = [
    ...appointmentColumns(name, onOpen, true),
    {
      id: "note",
      header: "Note",
      cell: (a: Appointment) => (
        <span className="text-ink-600">{a.cancellation_reason || a.reason || "—"}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Input
          label="From"
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          label="To"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
        <p className="text-small text-ink-600 pb-3">
          Completed, no-show and cancelled appointments.
        </p>
      </div>
      <div className="rounded-card border-line bg-surface shadow-card overflow-hidden border">
        <DataTable
          caption="Appointment history"
          columns={columns}
          rows={history.data ? rows : undefined}
          rowId={(a) => a.id}
          error={history.isError}
          onRetry={() => history.refetch()}
          empty={<EmptyState title="Nothing in this period." />}
        />
      </div>
    </div>
  );
}

export { weekStart };
