"use client";

import { useSyncExternalStore } from "react";
import { BEFORE_IN_ROUTE, COTS_IN_ROUTE } from "@/config/cots";

const noop = () => () => {};
// Today in the viewer's own time zone ("2026-11-20"); null on the server, so hydration matches.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A delivery date that has passed while the order still isn't here (to order or In Route) shows
// red (audit, 2026-11-20).
export function useOverdue(date: string | null | undefined, status: string) {
  const now = useSyncExternalStore(noop, today, () => null);
  return !!date && !!now && date < now && ([...BEFORE_IN_ROUTE, COTS_IN_ROUTE] as string[]).includes(status);
}
