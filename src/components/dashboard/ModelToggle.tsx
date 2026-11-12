"use client";

import { Segmented } from "@/components/ui/Segmented";

export type ModelKind = "basepart" | "final";

// Basepart | Final at the top of a 3D view (Harel, 2026-11-12): the robot's or system's Basepart
// (designed first) and its Final (the finished parts, the BOM's source) are both kept, so either
// can be looked at once both exist.
export function ModelToggle({ value, onChange }: { value: ModelKind; onChange: (v: ModelKind) => void }) {
  return (
    <Segmented
      label="3D model"
      value={value}
      onChange={onChange}
      options={[
        { value: "basepart", label: "Basepart" },
        { value: "final", label: "Final" },
      ]}
    />
  );
}

// The choice in the page's address (?model=basepart), so a reload or a shared link keeps it.
export function rememberModel(kind: ModelKind) {
  try {
    const u = new URL(location.href);
    if (kind === "basepart") u.searchParams.set("model", "basepart");
    else u.searchParams.delete("model");
    history.replaceState(history.state, "", u);
  } catch {}
}

// Which model a viewer starts on: the one asked for when it exists, else the Final when there is
// one, else the Basepart.
export function startModel(asked: ModelKind | undefined, final: boolean, basepart: boolean): ModelKind {
  if (asked === "basepart" && basepart) return "basepart";
  if (asked === "final" && final) return "final";
  return final || !basepart ? "final" : "basepart";
}
