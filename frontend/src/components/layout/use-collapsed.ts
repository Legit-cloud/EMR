import { useCallback, useState } from "react";

const KEY = "emr.sidebar.collapsed";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // Storage can be blocked (private windows, strict settings); the toggle still works.
  }
}

/** Whether the user collapsed the sidebar, remembered in this browser only. */
export function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      write(!current);
      return !current;
    });
  }, []);
  return [collapsed, toggle];
}
