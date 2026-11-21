"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { refreshIfDue } from "@/app/(app)/parts-actions";

const EVERY_MS = 5 * 60_000;

// While a system page is open and visible, asks the server every few minutes whether the
// Onshape document changed (the server decides if a check is due), and reloads the page data
// when the BOM was updated. A hidden tab asks nothing; coming back after a missed tick asks once.
export function AutoRefresh({ systemId }: { systemId: string }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let last = 0;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      try {
        const { changed } = await refreshIfDue(systemId);
        if (changed && !stopped) router.refresh();
      } catch {
        // A failed check waits for the next tick.
      }
    };
    const onVisible = () => {
      if (Date.now() - last >= EVERY_MS) void tick();
    };
    void tick();
    const timer = setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [systemId, router]);
  return null;
}
