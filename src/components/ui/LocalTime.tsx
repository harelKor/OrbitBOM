"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

// A time in the viewer's own locale and time zone. The server (UTC, another locale) would write
// it differently and break hydration, so until the page is live in the browser it shows the date.
export function LocalTime({ at, style = "medium" }: { at: string; style?: "medium" | "full" }) {
  const browser = useSyncExternalStore(noop, () => true, () => false);
  return <>{browser ? new Date(at).toLocaleString(undefined, { dateStyle: style, timeStyle: "short" }) : at.slice(0, 10)}</>;
}
