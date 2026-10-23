"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { MODE_COOKIE, type Mode } from "./mode";

// View mode (the default) hides delete, sync and property editors; Edit mode shows them.
const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: "view", setMode: () => {} });

export function ModeProvider({ initial, children }: { initial: Mode; children: React.ReactNode }) {
  const [mode, setState] = useState(initial);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const setMode = (m: Mode) => {
    setState(m);
    document.cookie = `${MODE_COOKIE}=${m}; path=/; max-age=31536000; samesite=lax`;
    // Server-rendered controls (Update BOM, delete buttons) read the cookie.
    startTransition(() => router.refresh());
  };
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export const useMode = () => useContext(ModeContext);
export const useEditMode = () => useContext(ModeContext).mode === "edit";

// Its children edit as in Edit mode whatever the page's mode (the part details window).
export function EditScope({ children }: { children: React.ReactNode }) {
  const { setMode } = useMode();
  return <ModeContext.Provider value={{ mode: "edit", setMode }}>{children}</ModeContext.Provider>;
}

// Renders its children only in Edit mode.
export function EditOnly({ children }: { children: React.ReactNode }) {
  return useEditMode() ? children : null;
}

export function ModeToggle() {
  const { mode, setMode } = useMode();
  return (
    <Segmented
      tone="onAccent"
      label="Mode"
      value={mode}
      onChange={setMode}
      options={[
        { value: "view", label: "View" },
        { value: "edit", label: "Edit" },
      ]}
    />
  );
}
