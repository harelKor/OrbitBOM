"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { ROBOT_COOKIE } from "./mode";
import type { ShellRobot } from "@/lib/data/shell";

const ROBOT_PATH = /^\/robots\/([0-9a-f-]{36})(?:\/systems\/([0-9a-f-]{36}))?/;

// A robot picked in the Robots panel without leaving the page. It wins over the page's robot until
// the user opens another robot's page, so the side links (To Fab, To Review...) follow the pick.
type Pick = { id: string; pagePath: string | null };
let picked: Pick | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setCookie(id: string) {
  document.cookie = `${ROBOT_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}

// Makes `id` the shell's robot, staying on the current page.
export function selectRobot(id: string) {
  const fromPath = window.location.pathname.match(ROBOT_PATH)?.[1] ?? null;
  picked = { id, pagePath: fromPath };
  setCookie(id);
  listeners.forEach((fn) => fn());
}

// The robot (and system) the shell points at: the one picked in the Robots panel, else the one in
// the URL, else the last one visited, else the newest active robot.
export function useRobotContext(robots: ShellRobot[], lastRobotId: string | null) {
  const pathname = usePathname();
  const pick = useSyncExternalStore(
    subscribe,
    () => picked,
    () => null,
  );
  const match = pathname.match(ROBOT_PATH);
  const fromPath = match?.[1] ?? null;
  // Opening a different robot's page ends the pick; pages without a robot keep it.
  const pickId = pick && (!fromPath || fromPath === pick.pagePath || fromPath === pick.id) ? pick.id : null;
  const robotId =
    [pickId, fromPath, lastRobotId].find((id) => id && robots.some((r) => r.id === id)) ??
    robots.find((r) => r.folder !== "old")?.id ??
    null;

  useEffect(() => {
    if (picked && fromPath !== picked.pagePath) {
      if (!fromPath) picked.pagePath = null;
      else {
        // Opened a robot's page (the picked one or another): the URL leads again.
        picked = null;
        listeners.forEach((fn) => fn());
      }
    }
    if (fromPath && !picked) setCookie(fromPath);
  }, [fromPath]);

  return {
    pathname,
    robot: robots.find((r) => r.id === robotId) ?? null,
    // The page's system only counts while the shell points at that page's robot.
    systemId: robotId === fromPath ? (match?.[2] ?? null) : null,
  };
}
