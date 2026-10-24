"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ShellRobot } from "@/lib/data/shell";
import { useRobotContext } from "./useRobotContext";

// Shift + a letter jumps to a main page, not while typing (Ctrl+Z / Undo lives in UndoRedo).
// Robot pages go to the robot the left nav points at.
export function Shortcuts({ robots, lastRobotId }: { robots: ShellRobot[]; lastRobotId: string | null }) {
  const router = useRouter();
  const { robot } = useRobotContext(robots, lastRobotId);
  const base = robot ? `/robots/${robot.id}` : null;

  useEffect(() => {
    const pages: Record<string, string | null> = {
      D: base,
      F: base && `${base}/fab`,
      R: base && `${base}/review`,
      C: "/cots",
      V: "/inventory",
      I: "/inventory",
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const href = pages[e.key.toUpperCase()];
      if (!href) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      router.push(href);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [base, router]);

  return null;
}
