"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { focusPart } from "@/components/actions/focusPart";
import { VISIT_COOKIE, encodeVisit } from "./visit";

// The open visit's id, for Recent actions to leave out until the member leaves the page.
let openVisit: string | null = null;
const listeners = new Set<() => void>();
export function useOpenVisit() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => openVisit,
    () => null,
  );
}

// Opens a new visit each time the member enters a page (a new path), and keeps the page's
// query (a To Fab machine, a view) up to date within it. Also scrolls to the part named in
// the URL's #part-<id>, which Recent actions links to.
export function VisitTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const visit = useRef<{ id: string; path: string } | null>(null);

  useEffect(() => {
    if (visit.current?.path !== pathname) visit.current = { id: crypto.randomUUID(), path: pathname };
    const page = search ? `${pathname}?${search}` : pathname;
    document.cookie = `${VISIT_COOKIE}=${encodeVisit(visit.current.id, page)}; path=/; SameSite=Lax`;
    if (openVisit !== visit.current.id) {
      openVisit = visit.current.id;
      listeners.forEach((l) => l());
    }
  }, [pathname, search]);

  useEffect(() => {
    const fromHash = () => {
      const m = /^#part-([0-9a-f-]{36})$/i.exec(window.location.hash);
      if (m) focusPart(m[1]);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [pathname, search]);

  return null;
}
