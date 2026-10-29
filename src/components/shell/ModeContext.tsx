"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { can, MODE_COOKIE, type AdminMode, type Capability, type Mode, type TeamView } from "./mode";

// The effective mode (see mode.ts): an admin's Edit | CAD | Build pick, else the member's team,
// with a team member's View | Edit pick in `editing`.
const ModeContext = createContext<{ mode: Mode; editing: boolean; isAdmin: boolean; pick: (value: AdminMode | TeamView) => void }>({
  mode: "none",
  editing: false,
  isAdmin: false,
  pick: () => {},
});

export function ModeProvider({ initial, editing: initialEditing, isAdmin, children }: { initial: Mode; editing: boolean; isAdmin: boolean; children: React.ReactNode }) {
  const [state, setState] = useState({ mode: initial, editing: initialEditing });
  // A new server mode (a team picked on /profile, an admin's change) replaces the shown one.
  const [seen, setSeen] = useState({ mode: initial, editing: initialEditing });
  if (seen.mode !== initial || seen.editing !== initialEditing) {
    setSeen({ mode: initial, editing: initialEditing });
    setState({ mode: initial, editing: initialEditing });
  }
  const router = useRouter();
  const [, startTransition] = useTransition();
  const pick = (value: AdminMode | TeamView) => {
    if (state.mode === "none") return;
    if (isAdmin) {
      if (value === "view") return;
      setState({ mode: value, editing: value === "edit" });
    } else {
      if (value !== "view" && value !== "edit") return;
      setState((s) => ({ ...s, editing: value === "edit" }));
    }
    document.cookie = `${MODE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    // Server-rendered pages (the robot dashboard, Update BOM, delete buttons) read the cookie.
    startTransition(() => router.refresh());
  };
  return <ModeContext.Provider value={{ ...state, isAdmin, pick }}>{children}</ModeContext.Provider>;
}

export const useMode = () => useContext(ModeContext);
export function useCan(cap: Capability) {
  const { mode, editing } = useContext(ModeContext);
  return can(mode, cap, editing);
}
// The Edit toggle is on: an admin in Edit, or a CAD / Build member who switched to Edit.
export const useEditMode = () => useCan("edit");
// Admin in Edit mode: deletes, bulk edit, merge, manual parts, robot and system settings.
export const useManage = () => useCan("manage");

export function usePermissions() {
  const { mode, editing, isAdmin } = useContext(ModeContext);
  return {
    mode,
    isAdmin,
    canWork: can(mode, "work", editing),
    canDraw: can(mode, "draw", editing),
    canReview: can(mode, "review", editing),
    canSync: can(mode, "sync", editing),
    canEdit: can(mode, "edit", editing),
    canManage: can(mode, "manage", editing),
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

// Admins: Edit, or the app as the CAD or Build Team sees it. CAD and Build members: View | Edit.
// Members without a team get no toggle.
export function ModeToggle() {
  const { mode, editing, isAdmin, pick } = useMode();
  if (isAdmin)
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
  if (mode === "none") return null;
  return (
    <Segmented
      tone="onAccent"
      label="Mode"
      value={(editing ? "edit" : "view") as TeamView}
      onChange={pick}
      options={[
        { value: "view", label: "View" },
        { value: "edit", label: "Edit" },
      ]}
    />
  );
}
