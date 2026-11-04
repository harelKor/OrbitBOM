"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

// A time in the viewer's own locale and time zone. The server (UTC, another locale) would write
// it differently and break hydration, so until the page is live in the browser it shows the date.
// "day" is the date alone, short ("4 Nov"), with the year only when it isn't this year's.
export function LocalTime({ at, style = "medium" }: { at: string; style?: "medium" | "full" | "day" }) {
  const browser = useSyncExternalStore(noop, () => true, () => false);
  if (!browser) return <>{at.slice(0, 10)}</>;
  const d = new Date(at);
  if (style === "day")
    return <>{d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) })}</>;
  return <>{d.toLocaleString(undefined, { dateStyle: style, timeStyle: "short" })}</>;
}
