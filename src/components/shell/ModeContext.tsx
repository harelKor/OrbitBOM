"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { can, MODE_COOKIE, type AdminMode, type Capability, type Mode } from "./mode";

// The effective mode (see mode.ts): an admin's Edit | CAD | Build pick, else the member's team.
const ModeContext = createContext<{ mode: Mode; isAdmin: boolean; pick: (value: AdminMode) => void }>({
  mode: "none",
  isAdmin: false,
  pick: () => {},
});

export function ModeProvider({ initial, isAdmin, children }: { initial: Mode; isAdmin: boolean; children: React.ReactNode }) {
  const [mode, setState] = useState(initial);
  // A new server mode (a team picked on /profile, an admin's change) replaces the shown one.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setState(initial);
  }
  const router = useRouter();
  const [, startTransition] = useTransition();
  const pick = (value: AdminMode) => {
    if (!isAdmin) return;
    setState(value);
    document.cookie = `${MODE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    // Server-rendered pages (the robot dashboard, Update BOM, delete buttons) read the cookie.
    startTransition(() => router.refresh());
  };
  return <ModeContext.Provider value={{ mode, isAdmin, pick }}>{children}</ModeContext.Provider>;
}

export const useMode = () => useContext(ModeContext);
export const useCan = (cap: Capability) => can(useContext(ModeContext).mode, cap);
// Admin in Edit mode: deletes, bulk edit, merge, manual parts, robot and system settings.
export const useManage = () => useCan("manage");

export function usePermissions() {
  const { mode, isAdmin } = useContext(ModeContext);
  return {
    mode,
    isAdmin,
    canWork: can(mode, "work"),
    canDraw: can(mode, "draw"),
    canReview: can(mode, "review"),
    canSync: can(mode, "sync"),
    canClassify: can(mode, "classify"),
    canManage: can(mode, "manage"),
  };
}

// Renders its children only when the mode allows `cap`.
export function Can({ cap, children }: { cap: Capability; children: React.ReactNode }) {
  return useCan(cap) ? children : null;
}

// Renders its children only for an admin in Edit mode.
export function EditOnly({ children }: { children: React.ReactNode }) {
  return useManage() ? children : null;
}

// Admins: Edit, or the app as the CAD or Build Team sees it. Everyone else works in their team's
// one view, with no toggle.
export function ModeToggle() {
  const { mode, isAdmin, pick } = useMode();
  if (!isAdmin) return null;
  return (
    <Segmented
      tone="onAccent"
      label="Mode"
      value={mode as AdminMode}
      onChange={pick}
      options={[
        { value: "edit", label: "Edit" },
        { value: "cad", label: "CAD" },
        { value: "build", label: "Build" },
      ]}
    />
  );
}
