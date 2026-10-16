"use client";

import { Buildings, CaretDown, CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";

import { LogoMark, PRODUCT_NAME } from "./logo";
import { activeItem, type NavGroup } from "./nav-config";

export type Facility = { id: string; name: string; code: string };

export type FacilitySwitch = {
  facilities: Facility[];
  current: Facility | null;
  onSelect: (facility: Facility) => void;
};

type Props = {
  groups: NavGroup[];
  pathname: string;
  facility: FacilitySwitch;
  /**
   * "responsive": full width from 1280 px, icon rail from 1024 px or when collapsed.
   * "drawer": always full width, inside the small-screen drawer.
   */
  mode?: "responsive" | "drawer";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
};

export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

/** The staff app sidebar (docs/DESIGN.md Section 6). */
export function Sidebar({
  groups,
  pathname,
  facility,
  mode = "responsive",
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: Props) {
  const drawer = mode === "drawer";
  // Labels stay readable by screen readers in the icon rail.
  const label = drawer ? "" : collapsed ? "sr-only" : "sr-only xl:not-sr-only";
  const showWhenWide = drawer ? "" : collapsed ? "hidden" : "hidden xl:block";
  const current = activeItem(pathname, groups);

  return (
    <div
      data-collapsed={collapsed || undefined}
      className={`bg-sidebar border-line relative flex h-full flex-col border-r ${
        drawer ? "w-60" : collapsed ? "w-[72px]" : "w-[72px] xl:w-60"
      }`}
    >
      <div className="flex h-16 items-center gap-2 px-5">
        <LogoMark />
        <span className={`text-page-title text-ink-900 ${showWhenWide}`}>{PRODUCT_NAME}</span>
      </div>

      {!drawer && onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`border-line bg-surface text-ink-500 hover:text-ink-900 shadow-card absolute top-5 -right-3 z-10 hidden size-6 place-items-center rounded-full border xl:grid ${FOCUS_RING}`}
        >
          {collapsed ? <CaretRight size={12} /> : <CaretLeft size={12} />}
        </button>
      )}

      <div className="px-3 pb-2">
        <FacilitySwitcher {...facility} label={label} showWhenWide={showWhenWide} />
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group, index) => (
          <div key={group.caption ?? index} className={group.caption ? "mt-6" : "mt-2"}>
            {group.caption && (
              // not-sr-only resets padding, so the label class goes on an inner span.
              <p className="text-label-caps text-ink-500 mb-2 px-3 uppercase">
                <span className={label}>{group.caption}</span>
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const active = item === current;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      className={`rounded-control text-body flex h-10 items-center gap-3 px-3 ${FOCUS_RING} ${
                        active
                          ? "bg-blue-100 font-semibold text-blue-600"
                          : "text-ink-600 hover:bg-nav-hover hover:text-ink-900"
                      }`}
                    >
                      <Icon
                        aria-hidden
                        size={20}
                        weight={active ? "fill" : collapsed ? "duotone" : "regular"}
                        className={`shrink-0 ${active ? "text-blue-600" : "text-ink-500"}`}
                      />
                      <span className={label}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function FacilitySwitcher({
  facilities,
  current,
  onSelect,
  label,
  showWhenWide,
}: FacilitySwitch & { label: string; showWhenWide: string }) {
  const name = current?.name ?? "No facility";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Facility: ${name}. Change facility`}
        disabled={facilities.length === 0}
        className={`rounded-card border-line bg-surface shadow-card flex w-full items-center gap-3 border p-2 text-left ${FOCUS_RING}`}
      >
        <span className="rounded-control bg-blue-100 grid size-9 shrink-0 place-items-center text-blue-600">
          <Buildings aria-hidden size={20} weight="fill" />
        </span>
        <span className={`min-w-0 flex-1 ${label}`}>
          <span className="text-body text-ink-900 block truncate font-semibold">{name}</span>
          {current && (
            <span className="text-small text-ink-600 block truncate">{current.code}</span>
          )}
        </span>
        {facilities.length > 1 && (
          <CaretDown aria-hidden size={16} className={`text-ink-500 shrink-0 ${showWhenWide}`} />
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="rounded-menu border-line bg-surface shadow-pop z-50 min-w-56 border p-1"
        >
          <DropdownMenu.Label className="text-label-caps text-ink-500 px-3 py-2 uppercase">
            Facility
          </DropdownMenu.Label>
          {facilities.map((f) => (
            <DropdownMenu.Item
              key={f.id}
              onSelect={() => onSelect(f)}
              className="rounded-control text-body text-ink-900 data-[highlighted]:bg-nav-hover flex h-10 cursor-pointer items-center gap-2 px-3 outline-none"
            >
              <span className="flex-1">{f.name}</span>
              {f.id === current?.id && (
                <Check aria-label="Selected" size={16} className="text-blue-600" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
