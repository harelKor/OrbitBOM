"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

// A time in the viewer's own locale and time zone. The server (UTC, another locale) would write
// it differently and break hydration, so until the page is live in the browser it shows the date.
// "ago" is how long ago ("5 min ago"), the full date on hover, like Onshape's comments.
// "day" is the date alone, short ("4 Nov"), with the year only when it isn't this year's.
export function LocalTime({ at, style = "medium" }: { at: string; style?: "medium" | "full" | "day" | "ago" }) {
  const browser = useSyncExternalStore(noop, () => true, () => false);
  if (!browser) return <>{at.slice(0, 10)}</>;
  const d = new Date(at);
  if (style === "ago") return <Ago d={d} />;
  if (style === "day")
    return <>{d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) })}</>;
  return <>{d.toLocaleString(undefined, { dateStyle: style, timeStyle: "short" })}</>;
}

// The minute it is now, ticking once a minute while something shows "… ago".
const minute = (fire: () => void) => {
  const t = setInterval(fire, 60_000);
  return () => clearInterval(t);
};
const thisMinute = () => Math.floor(Date.now() / 60_000);

function Ago({ d }: { d: Date }) {
  const now = useSyncExternalStore(minute, thisMinute, thisMinute);
  const m = now - Math.floor(d.getTime() / 60_000);
  const text = m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : m < 7 * 1440 ? `${Math.floor(m / 1440)} d ago` : d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
  return <span title={d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}>{text}</span>;
}
