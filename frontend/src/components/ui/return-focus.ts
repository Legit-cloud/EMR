import { useLayoutEffect, useRef } from "react";

/**
 * Radix returns focus only to its own Dialog.Trigger. Our modals and drawers open from
 * controlled state (menus, table rows, the + button), so this remembers whatever had focus
 * when `open` turned true and hands back an onCloseAutoFocus that returns focus there.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);

  // Layout effects run before Radix moves focus into the dialog in its passive effect.
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (event: Event) => {
    const target = opener.current;
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
    opener.current = null;
  };
}
