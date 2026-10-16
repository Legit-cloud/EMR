"use client";

import { X } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { PRODUCT_NAME } from "./logo";
import { activeItem, roleLabel, visibleNav, visibleQuickCreate } from "./nav-config";
import { type FacilitySwitch, FOCUS_RING, Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { useCollapsed } from "./use-collapsed";

type Props = {
  user: { name: string; roles: readonly string[] };
  facility: FacilitySwitch;
  onSignOut: () => void;
  children: ReactNode;
};

/** Sidebar, top bar and content area for the signed-in staff app. */
export function AppShell({ user, facility, onSignOut, children }: Props) {
  const pathname = usePathname();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const groups = visibleNav(user.roles);
  const title = activeItem(pathname)?.label ?? PRODUCT_NAME;

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className={`bg-surface text-body rounded-control shadow-pop sr-only z-50 p-3 text-blue-600 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 ${FOCUS_RING}`}
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen shrink-0 lg:block">
        <Sidebar
          groups={groups}
          pathname={pathname}
          facility={facility}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim lg:hidden" />
          <Dialog.Content className="shadow-modal fixed inset-y-0 left-0 z-50 lg:hidden">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <Dialog.Description className="sr-only">Main navigation</Dialog.Description>
            <Sidebar
              groups={groups}
              pathname={pathname}
              facility={facility}
              mode="drawer"
              onNavigate={() => setDrawerOpen(false)}
            />
            <Dialog.Close
              aria-label="Close menu"
              className={`text-ink-600 hover:bg-nav-hover rounded-control absolute top-3 right-3 grid size-10 place-items-center ${FOCUS_RING}`}
            >
              <X aria-hidden size={20} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          user={{ name: user.name, role: roleLabel(user.roles) }}
          quickCreate={visibleQuickCreate(user.roles)}
          onSignOut={onSignOut}
          onOpenNav={() => setDrawerOpen(true)}
        />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
