"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { NoAccess } from "@/components/auth/no-access";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { type Bed, countBeds, stayDay, useWards, type Ward } from "@/lib/inpatient";
import { usePermissions } from "@/lib/permissions";
import { isNotAvailable } from "@/lib/planned-api";
import { BED_STATUS, type BedStatus, TONES } from "@/lib/status-map";

import { BedDrawer } from "./bed-drawer";

const ORDER: BedStatus[] = ["vacant", "occupied", "cleaning", "out_of_service"];

function BedTile({ ward, bed, onOpen }: { ward: Ward; bed: Bed; onOpen: () => void }) {
  const spec = BED_STATUS[bed.status];
  const tone = TONES[spec.tone];
  const Glyph = spec.icon;
  const who = bed.occupant;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${ward.name}, ${bed.label}, ${spec.label}${who ? `, ${who.patient_name}` : ""}`}
      className={cx(
        "rounded-card border-line flex min-h-28 flex-col gap-2 border p-3 text-left transition-colors duration-150 hover:border-blue-600",
        tone.tint,
        FOCUS_RING,
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-body text-ink-900 font-bold">{bed.label}</span>
        <span className={cx("text-pill flex items-center gap-1 uppercase", tone.text)}>
          <Glyph aria-hidden size={14} weight="fill" />
          {spec.label}
        </span>
      </span>
      {who ? (
        <span className="flex min-w-0 flex-col">
          <span className="text-body text-ink-900 truncate font-semibold">{who.patient_name}</span>
          <span className="text-small text-ink-600 tnum">Day {stayDay(who.admitted_at)}</span>
        </span>
      ) : (
        <span className="text-small text-ink-600">
          {bed.status === "vacant"
            ? "Ready for a patient"
            : bed.status === "cleaning"
              ? "Being cleaned"
              : "Not in use"}
        </span>
      )}
    </button>
  );
}

/**
 * The ward and bed board: a tile for every bed in the bed-status colours (never colour alone),
 * a count of each state, and a right drawer to admit, transfer and discharge. The open bed
 * lives in the address (?bed=). Backed by apps/inpatient (docs/adr/0021).
 */
export function WardBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const permissions = usePermissions();
  const wards = useWards();
  const canChange = permissions.hasRole("nurse", "doctor");

  if (wards.error instanceof ApiRequestError && wards.error.status === 403) {
    return <NoAccess what="the ward board" asPage />;
  }

  const data = wards.data;
  const counts = data ? countBeds(data) : null;
  const openId = params.get("bed");
  const openWard = data?.find((w) => w.beds.some((b) => b.id === openId)) ?? null;
  const openBed = openWard?.beds.find((b) => b.id === openId) ?? null;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Wards and beds</h1>
        {counts && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {counts.total} beds
          </span>
        )}
      </header>

      {counts && (
        <ul aria-label="Beds by status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ORDER.map((status) => {
            const spec = BED_STATUS[status];
            const Glyph = spec.icon;
            return (
              <li
                key={status}
                className="rounded-card border-line bg-surface shadow-card flex items-center gap-3 border p-4"
              >
                <span
                  aria-hidden
                  className={cx(
                    "rounded-control grid size-10 shrink-0 place-items-center",
                    TONES[spec.tone].tint,
                  )}
                >
                  <Glyph size={24} weight="fill" className={TONES[spec.tone].icon} />
                </span>
                <span className="flex flex-col">
                  <span className="text-small text-ink-600">{spec.label}</span>
                  <span className="text-card-title text-ink-900 tnum">{counts[status]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {wards.isPending ? (
        <Loading label="Loading wards">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </Loading>
      ) : wards.isError ? (
        <Card>
          <EmptyState
            title={
              isNotAvailable(wards.error)
                ? "Inpatient care is not available yet."
                : "The ward board could not be loaded."
            }
            action={
              isNotAvailable(wards.error) ? undefined : (
                <Button variant="outline" onClick={() => wards.refetch()}>
                  Try again
                </Button>
              )
            }
          />
        </Card>
      ) : data && data.length === 0 ? (
        <Card>
          <EmptyState title="No wards have been set up yet." />
        </Card>
      ) : (
        data?.map((ward) => {
          const occupied = ward.beds.filter((b) => b.status === "occupied").length;
          return (
            <Card
              key={ward.id}
              title={ward.name}
              action={
                <span className="text-small text-ink-600 tnum">
                  {occupied} of {ward.beds.length} occupied
                </span>
              }
            >
              <ul
                aria-label={`${ward.name} beds`}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              >
                {ward.beds.map((bed) => (
                  <li key={bed.id}>
                    <BedTile
                      ward={ward}
                      bed={bed}
                      onOpen={() => router.replace(`${pathname}?bed=${bed.id}`, { scroll: false })}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}

      <BedDrawer
        bed={openBed}
        ward={openWard}
        wards={data ?? []}
        canChange={canChange}
        onClose={() => router.replace(pathname, { scroll: false })}
      />
    </>
  );
}
