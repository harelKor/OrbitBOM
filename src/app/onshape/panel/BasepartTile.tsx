"use client";

import { useState, useTransition } from "react";
import { buildModel } from "@/components/viewer/buildModel";
import { tileClass, TileBody } from "./tiles";

// Update 3D view on a Basepart (Harel, 2026-11-12): the Basepart has no BOM, so its one update is
// the Basepart 3D model (its Part Studio or assembly, and its Geometry sketches), built from here.
export function BasepartTile({ robotId }: { robotId: string }) {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const update = () =>
    start(async () => {
      setNote(null);
      setProgress("Checking Onshape…");
      const r = await buildModel(robotId, setProgress, "basepart");
      setProgress(null);
      if (!r.ok) return setNote({ text: r.error, bad: true });
      setNote({ text: r.unchanged ? `The Basepart 3D view is up to date (${r.calls} Onshape calls).` : `Basepart 3D view updated: ${r.parts} parts (${r.calls} Onshape calls).` });
    });
  return (
    <button type="button" onClick={update} disabled={busy} aria-busy={busy} className={tileClass("accent")}>
      {/* Loading… with a spinner while it works, like Update system (Harel, 2026-11-13). */}
      <TileBody icon={busy ? "" : "⟳"} title={busy ? "Loading…" : "Update 3D view"} sub={progress ?? note?.text ?? "The Basepart and its Geometry sketches"} subClass={note?.bad && !busy ? "!text-rose-100" : ""} />
      {busy && <span className="absolute top-1/2 left-9 h-8 w-8 -translate-y-1/2 animate-spin rounded-full border-4 border-white/30 border-t-white" aria-hidden />}
    </button>
  );
}
