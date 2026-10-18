"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { refreshIfDue } from "@/app/(app)/parts-actions";

const EVERY_MS = 5 * 60_000;

// While a system page is open and visible, asks the server every few minutes whether the
// Onshape document changed (the server decides if a check is due), and reloads the page data
// when the BOM was updated.
export function AutoRefresh({ systemId }: { systemId: string }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { changed } = await refreshIfDue(systemId);
        if (changed && !stopped) router.refresh();
      } catch {
        // A failed check waits for the next tick.
      }
    };
    void tick();
    const timer = setInterval(tick, EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [systemId, router]);
  return null;
}
