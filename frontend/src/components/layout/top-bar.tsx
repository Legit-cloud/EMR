"use client";

import { CaretDown, Flag, List, MagnifyingGlass, Plus, SignOut } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useSyncExternalStore } from "react";

import { Avatar } from "@/components/ui/avatar";

import type { QuickCreateItem } from "./nav-config";
import { FOCUS_RING } from "./sidebar";

type Props = {
  title: string;
  user: { name: string; role: string };
  quickCreate: QuickCreateItem[];
  onSignOut: () => void;
  onOpenNav: () => void;
  /** Tenant setup steps; the chip hides when absent or complete. */
  setup?: { done: number; total: number };
};

const MENU_CONTENT = "rounded-menu border-line bg-surface shadow-pop z-50 min-w-48 border p-1";
const MENU_ITEM =
  "rounded-control text-body text-ink-900 data-[highlighted]:bg-nav-hover flex h-10 cursor-pointer items-center gap-2 px-3 outline-none";

function subscribeNever() {
  return () => {};
}

/** "⌘K" on a Mac, "Ctrl K" elsewhere; the shortcut works with either key. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

/** The top bar (docs/DESIGN.md Section 6). */
export function TopBar({ title, user, quickCreate, onSignOut, onOpenNav, setup }: Props) {
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const shortcut = useShortcutLabel();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    router.push(query ? `/patients?search=${encodeURIComponent(query)}` : "/patients");
  }

  return (
    <header className="border-line bg-surface flex h-16 items-center gap-3 border-b px-4 lg:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open menu"
        className={`rounded-control text-ink-600 hover:bg-nav-hover grid size-10 place-items-center lg:hidden ${FOCUS_RING}`}
      >
        <List aria-hidden size={20} />
      </button>

      <p className="text-page-title text-ink-900 min-w-0 flex-1 truncate">{title}</p>

      <form role="search" onSubmit={onSearch} className="hidden md:block">
        <label className="rounded-pill bg-search-fill text-ink-600 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600 flex h-10 w-[360px] max-w-[36vw] items-center gap-2 px-4">
          <MagnifyingGlass aria-hidden size={16} className="text-ink-500 shrink-0" />
          <span className="sr-only">Search patients</span>
          <input
            ref={search}
            name="q"
            type="search"
            placeholder="Search for anything here…"
            className="text-body text-ink-900 placeholder:text-ink-400 min-w-0 flex-1 bg-transparent outline-none"
          />
          <kbd className="text-small text-ink-500 font-sans">{shortcut}</kbd>
        </label>
      </form>

      {quickCreate.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label="Create new"
            className={`grid size-10 shrink-0 place-items-center rounded-full bg-blue-600 text-surface hover:bg-blue-700 ${FOCUS_RING}`}
          >
            <Plus aria-hidden size={20} weight="bold" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={MENU_CONTENT}>
              {quickCreate.map((item) => (
                <DropdownMenu.Item key={item.href + item.label} asChild className={MENU_ITEM}>
                  <Link href={item.href}>{item.label}</Link>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      {setup && setup.done < setup.total && (
        <span
          className="rounded-pill bg-green-tint text-small text-green-text hidden items-center gap-1.5 px-3 py-1.5 font-semibold sm:inline-flex"
          aria-label={`Setup: ${setup.done} of ${setup.total} steps done`}
        >
          <Flag aria-hidden size={16} weight="fill" className="text-green" />
          {setup.done}/{setup.total}
        </span>
      )}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Account: ${user.name}`}
          className={`rounded-control hover:bg-nav-hover flex shrink-0 items-center gap-2 p-1 text-left ${FOCUS_RING}`}
        >
          <Avatar name={user.name} />
          <span className="hidden flex-col sm:flex">
            <span data-testid="signed-in-user" className="text-body text-ink-900 font-semibold">
              {user.name}
            </span>
            <span className="text-small text-ink-600">{user.role}</span>
          </span>
          <CaretDown aria-hidden size={16} className="text-ink-500 hidden sm:block" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className={MENU_CONTENT}>
            <DropdownMenu.Item onSelect={onSignOut} className={MENU_ITEM}>
              <SignOut aria-hidden size={20} className="text-ink-500" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
