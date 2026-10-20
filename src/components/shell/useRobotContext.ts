"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ROBOT_COOKIE } from "./mode";
import type { ShellRobot } from "@/lib/data/shell";

const ROBOT_PATH = /^\/robots\/([0-9a-f-]{36})(?:\/systems\/([0-9a-f-]{36}))?/;

// The robot (and system) the shell points at: the one in the URL, else the last one visited,
// else the newest active robot.
export function useRobotContext(robots: ShellRobot[], lastRobotId: string | null) {
  const pathname = usePathname();
  const match = pathname.match(ROBOT_PATH);
  const fromPath = match?.[1] ?? null;
  const robotId =
    [fromPath, lastRobotId].find((id) => id && robots.some((r) => r.id === id)) ??
    robots.find((r) => !r.archived)?.id ??
    null;

  useEffect(() => {
    if (fromPath) document.cookie = `${ROBOT_COOKIE}=${fromPath}; path=/; max-age=31536000; samesite=lax`;
  }, [fromPath]);

  return { pathname, robot: robots.find((r) => r.id === robotId) ?? null, systemId: match?.[2] ?? null };
}
