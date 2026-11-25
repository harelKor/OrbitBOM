"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { markPageSeen } from "@/app/(app)/seen-actions";
import { isNewSince } from "@/lib/seen";

// The new parts glow (src/lib/seen.ts) on the client: the newest arrival on each page and when
// this member last opened it, from the layout; a page opened now counts at once, before the server
// says so.
type Ctx = { newest: Record<string, string>; seen: Record<string, string>; seeNow: (page: string) => void };
const ArrivalsCtx = createContext<Ctx>({ newest: {}, seen: {}, seeNow: () => {} });

export function ArrivalsProvider({ newest, seen, children }: { newest: Record<string, string>; seen: Record<string, string>; children: React.ReactNode }) {
  const [local, setLocal] = useState<Record<string, string>>({});
  const seeNow = useCallback((page: string) => setLocal((l) => ({ ...l, [page]: new Date().toISOString() })), []);
  const value = useMemo(() => {
    const merged = { ...seen };
    for (const [k, at] of Object.entries(local)) if (!merged[k] || merged[k] < at) merged[k] = at;
    return { newest, seen: merged, seeNow };
  }, [newest, seen, local, seeNow]);
  return <ArrivalsCtx.Provider value={value}>{children}</ArrivalsCtx.Provider>;
}

// Whether a page (or, for Shop Fab, one of its tabs: `tab` = a machine) has parts this member
// hasn't seen. `prefix` checks every page starting with it (all of a robot's printers).
export function useArrivals() {
  const { newest, seen } = useContext(ArrivalsCtx);
  return {
    page: (page: string) => isNewSince(newest[page], seen[page]),
    tab: (page: string, tab: string) => isNewSince(newest[`${page}@${tab}`], seen[page]),
    any: (prefix: string) => Object.keys(newest).some((k) => k.startsWith(prefix) && !k.includes("@") && isNewSince(newest[k], seen[k])),
  };
}

// Put on a tracked page: opening it marks it seen, so its glow in the side panel and on the home
// boxes stops.
export function MarkSeen({ page }: { page: string }) {
  const { seeNow } = useContext(ArrivalsCtx);
  useEffect(() => {
    seeNow(page);
    markPageSeen(page).catch(() => {}); // offline: marked on the next visit
  }, [page, seeNow]);
  return null;
}

// On the page: parts that arrived since the member's last visit (`seenAt`, from before this one)
// glow until the first press anywhere on the screen. Parts the member changed last don't: they've
// seen them (`me` is their name, as cards carry it).
export function useArrivalHalo(seenAt: string | null, me?: string) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const off = () => setOn(false);
    document.addEventListener("pointerdown", off, { once: true, capture: true });
    return () => document.removeEventListener("pointerdown", off, { capture: true });
  }, [on]);
  return useCallback(
    (p: { stageAt?: Date | string | null; lastModifiedByName?: string | null }) => on && isNewSince(p.stageAt, seenAt) && !(me && p.lastModifiedByName === me),
    [on, seenAt, me],
  );
}

// Wraps a home box (the dashboard's Shop Fab, COTS's Released and Order List, a printer's or
// factory's box) and gives it the glow while its page has unseen new parts. `prefix`: any page
// starting with it. Takes no room: the box keeps its place in the grid.
export function ArrivalMark({ page, prefix, children }: { page?: string; prefix?: string; children: React.ReactNode }) {
  const arrivals = useArrivals();
  const glow = (page && arrivals.page(page)) || (prefix && arrivals.any(prefix));
  return (
    <div className="contents" data-arrival={glow ? "" : undefined}>
      {children}
    </div>
  );
}
