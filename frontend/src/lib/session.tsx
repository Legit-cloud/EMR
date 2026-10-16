"use client";

import { createContext, useContext } from "react";

import type { Schemas } from "./api";

export type Me = Schemas["Me"];

export const SessionContext = createContext<Me | null>(null);

/** The signed-in user. Roles are for convenience only: the API enforces access. */
export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useMe outside the signed-in app");
  return me;
}
