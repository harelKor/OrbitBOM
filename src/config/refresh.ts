// Background refresh (plan §4): how often each system's Onshape document is checked for
// changes. A check costs one Onshape call; a real BOM pull only happens when the document changed.

export const REFRESH = {
  // Both off to save Onshape's yearly API allowance: Onshape is only checked when a member clicks
  // Update BOM. `scheduled` is /api/cron/refresh; `openPages` is an open system page's check
  // every few minutes (AutoRefresh).
  scheduled: false,
  openPages: false,
  timeZone: "Asia/Jerusalem",
  // Build-season meeting hours, local time: checks every 10 minutes. Outside them, once an hour.
  activeHours: { from: 14, to: 23 },
  activeIntervalMinutes: 10,
  quietIntervalMinutes: 60,
} as const;

// Minutes between checks of one system at the given moment.
export function refreshIntervalMinutes(now: Date = new Date()): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: REFRESH.timeZone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  const { from, to } = REFRESH.activeHours;
  return hour >= from && hour < to ? REFRESH.activeIntervalMinutes : REFRESH.quietIntervalMinutes;
}
