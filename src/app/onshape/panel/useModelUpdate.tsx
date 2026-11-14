"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkCad, commitCad, type CadOwner } from "@/app/(app)/versions-actions";
import { buildModel, buildModelAndPictures } from "@/components/viewer/buildModel";
import { CadCommitWindow } from "@/components/versions/CadCommitWindow";
import type { ModelKind } from "@/db/schema";
import type { CadChange } from "@/lib/versions/cadDiff";

// Update CAD and Update Basepart in the Onshape panel (Harel, 2026-11-13): check Onshape (the tile
// shows Loading…), open the Commit window with what changed, commit, then rebuild that 3D model
// from here (and, for the Final, the pictures). `busy` and `status` drive the tile.
export function useModelUpdate(kind: ModelKind, owner: CadOwner, robotId: string) {
  const router = useRouter();
  const [checking, startCheck] = useTransition();
  const [committing, startCommit] = useTransition();
  const [found, setFound] = useState<{ draftId: string; changes: CadChange[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const what = kind === "basepart" ? "Basepart" : "CAD";

  const check = () =>
    startCheck(async () => {
      setNote(null);
      setError(null);
      const r = await checkCad(kind, owner).catch(asError);
      if (r.rebuildOnly) {
        setProgress("Updating the 3D view…");
        const b = await buildModel(r.rebuildOnly, setProgress, kind).catch((err) => ({ ok: false as const, calls: 0, ...asError(err) }));
        setProgress(null);
        return setNote(b.ok ? { text: `3D view updated (${b.calls} Onshape calls).` } : { text: b.error, bad: true });
      }
      if (r.error || !r.draftId) return setNote({ text: r.error ?? "The check failed.", bad: true });
      setFound({ draftId: r.draftId, changes: r.changes ?? [] });
      setOpen(true);
    });

  const commit = (makeVersion: boolean, name: string) =>
    startCommit(async () => {
      if (!found) return;
      setError(null);
      const r = await commitCad(kind, owner, found.draftId, makeVersion, name).catch(asError);
      if (r.error) return setError(r.error);
      setOpen(false);
      setFound(null);
      const done = r.message ?? `${what} updated.`;
      setNote({ text: done });
      setProgress("Updating the 3D views…");
      const b = await (kind === "basepart" ? buildModel(robotId, setProgress, "basepart") : buildModelAndPictures(robotId, "systemId" in owner ? owner.systemId : undefined, setProgress)).catch((err) => ({ ok: false as const, calls: 0, ...asError(err) }));
      setProgress(null);
      setNote(b.ok ? { text: `${done} 3D views updated (${(r.calls ?? 0) + b.calls} Onshape calls).` } : { text: `${done} The 3D views didn't update: ${b.error}`, bad: true });
      router.refresh();
    });

  const dialog = (
    <CadCommitWindow
      key={found?.draftId ?? "none"}
      open={open && !!found}
      onClose={() => setOpen(false)}
      robotId={robotId}
      what={what}
      changes={found?.changes ?? []}
      committing={committing}
      error={error}
      onCommit={commit}
    />
  );
  return {
    check,
    reopen: found ? () => setOpen(true) : null,
    busy: checking || committing || !!progress,
    status: progress ?? (checking ? "Checking Onshape for changes…" : committing ? "Committing…" : null),
    note,
    dialog,
  };
}

// A server action or build that threw (Onshape or the site unreachable, a lost connection): the
// tile says so instead of the panel falling to the error page.
export function asError(err: unknown): { error: string } & Partial<Record<"rebuildOnly" | "draftId" | "draft" | "changes" | "message" | "calls" | "rebuild", undefined>> {
  console.error(err);
  return { error: "The update didn't get an answer. Check the connection and try again." };
}
