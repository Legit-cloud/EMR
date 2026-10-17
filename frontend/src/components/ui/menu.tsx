"use client";

import { DotsThreeVertical, type Icon } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactElement } from "react";

import { cx } from "@/lib/cx";

import { IconButton } from "./button";

/** Shared with the shell's user and quick-create menus. */
export const MENU_CONTENT =
  "rounded-menu border-line bg-surface shadow-pop data-[state=open]:animate-pop-in z-50 min-w-48 border p-1 motion-reduce:animate-none";
export const MENU_ITEM =
  "rounded-control text-body text-ink-900 data-[highlighted]:bg-nav-hover data-[disabled]:text-ink-400 flex h-10 cursor-pointer items-center gap-2 px-3 outline-none data-[disabled]:cursor-not-allowed";

export type MenuItem = {
  label: string;
  icon?: Icon;
  onSelect: () => void;
  disabled?: boolean;
  /** Destructive actions read in pink and should open a confirm modal. */
  danger?: boolean;
};

type Props = {
  /** A button; it gets the menu's open state and keyboard handling. */
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
};

/** White dropdown, radius 12, popover shadow, 40 px rows with icons (docs/DESIGN.md Section 7). */
export function Menu({ trigger, items, align = "end" }: Props) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={MENU_CONTENT}>
          {items.map(({ label, icon: Glyph, onSelect, disabled, danger }) => (
            <DropdownMenu.Item
              key={label}
              disabled={disabled}
              onSelect={onSelect}
              className={cx(MENU_ITEM, danger && "text-pink-text")}
            >
              {Glyph && (
                <Glyph
                  aria-hidden
                  size={20}
                  className={danger ? "text-pink-text" : "text-ink-500"}
                />
              )}
              {label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Three-dot row or card menu. `label` names what it acts on, for example "Actions for #OS12KOS". */
export function KebabMenu({ label, items }: { label: string; items: MenuItem[] }) {
  return <Menu trigger={<IconButton icon={DotsThreeVertical} label={label} />} items={items} />;
}
