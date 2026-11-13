"use client";

import { tileClass, TileBody } from "./tiles";
import { useModelUpdate } from "./useModelUpdate";

// Update on a Basepart (Harel, 2026-11-12, 2026-11-13): the Basepart has no BOM, so its update is
// the Basepart 3D model (its Part Studio or assembly, and its Geometry sketches). Like Update CAD:
// Loading… while Onshape is checked, the Commit window with the parts that changed, Create version
// or a sub-version, then the Basepart 3D rebuilds from here. A system's Basepart, or the robot's
// own when `systemId` is null.
export function BasepartTile({ robotId, systemId }: { robotId: string; systemId: string | null }) {
  const u = useModelUpdate("basepart", systemId ? { systemId } : { robotId }, robotId);
  return (
    <>
      <button type="button" onClick={() => (u.reopen ? u.reopen() : u.check())} disabled={u.busy} aria-busy={u.busy} className={tileClass("accent")}>
        <TileBody icon={u.busy ? "" : "⟳"} title={u.busy ? "Loading…" : "Update Basepart"} sub={u.status ?? u.note?.text ?? "See what changed, then update the Basepart's 3D and version tree"} subClass={u.note?.bad && !u.busy ? "!text-rose-100" : ""} />
        {u.busy && <span className="absolute top-1/2 left-9 h-8 w-8 -translate-y-1/2 animate-spin rounded-full border-4 border-white/30 border-t-white" aria-hidden />}
      </button>
      {u.dialog}
    </>
  );
}
