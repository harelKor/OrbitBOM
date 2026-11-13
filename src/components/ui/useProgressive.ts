"use client";

import { startTransition, useEffect, useState } from "react";

const FIRST = 40;
const STEP = 60;

// How many of a long list's items to draw so far. A robot's page holds hundreds of part cards, and
// drawing them all at once held the page (and any tap) for over half a second; the first ones go
// in with the page, the rest a batch at a time in interruptible renders right after, so a tap in
// between is answered first. The page ends up exactly the same (Harel, 2026-11-13: speed).
export function useProgressive(total: number): number {
  const [limit, setLimit] = useState(FIRST);
  useEffect(() => {
    if (limit >= total) return;
    const id = setTimeout(() => startTransition(() => setLimit((l) => l + STEP)), 0);
    return () => clearTimeout(id);
  }, [limit, total]);
  return limit;
}
