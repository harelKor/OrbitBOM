"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitChanges, rebuildSystemModel } from "@/app/(app)/versions-actions";
import { Dialog } from "@/components/Dialog";
import { buildModelAndPictures } from "@/components/viewer/buildModel";
import { afterPartsUpdate } from "@/components/versions/afterUpdate";
import { CommitWindow } from "@/components/versions/CommitWindow";
import { RebuildDialog } from "@/components/versions/RebuildDialog";
import { panelCheckSystem, type PanelCheck } from "./update-actions";
import { tileClass, TileBody } from "./tiles";
import { asError, useModelUpdate } from "./useModelUpdate";

// Update system in the Onshape panel (Harel, 2026-11-11): a window with two big buttons.
// Update BOM checks Onshape and opens the Commit window right there (the commit makes Onshape's
// "V<next> BOM release" version, and moves the 3D views too when ticked). Update CAD moves this
// system's 3D and the CAD version tree to the assembly as it is now, after its own Commit window
// (Harel, 2026-11-13): a new Onshape version when "Create version" is ticked, else a sub-version
// "V12 v1". Members don't browse the app from inside Onshape, so it never goes to the system
// page; the 3D rebuild runs from here.
export function UpdateTile({ systemId, robotId }: { systemId: string; robotId: string }) {
  const router = useRouter();
  const [checking, startCheck] = useTransition();
  const [committing, startCommit] = useTransition();
  const [choose, setChoose] = useState(false);
  const cad = useModelUpdate("final", { systemId }, robotId);
  const [found, setFound] = useState<PanelCheck | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const draft = found?.draft ?? null;
  const waiting = draft?.changes.length ?? 0;

  // The 3D model and pictures after an update, with the steps on the tile.
  const rebuild = async (robotId: string, done: string) => {
    setProgress("Updating the 3D views…");
    const r = await buildModelAndPictures(robotId, systemId, setProgress).catch((err) => ({ ok: false as const, calls: 0, ...asError(err) }));
    setProgress(null);
    setNote(r.ok ? { text: `${done} 3D views updated (${r.calls} Onshape calls).` } : { text: `${done} The 3D views didn't update: ${r.error}`, bad: true });
    router.refresh();
  };

  const checkBom = () =>
    startCheck(async () => {
      setChoose(false);
      setNote(null);
      const r = await panelCheckSystem(systemId).catch(asError);
      if (r.error) return setNote({ text: r.error, bad: true });
      setFound(r);
      if (r.draft) {
        setCommitError(null);
        setOpen(true);
      } else {
        setNote({ text: "BOM is up to date with Onshape" });
        setUpToDate(true);
      }
    });

  // Rebuild 3D model from the Up to date window (Harel, 2026-11-18): read the assembly again.
  const rebuildAnyway = async () => {
    const r = await rebuildSystemModel(systemId).catch(asError);
    if (r.error) return setNote({ text: r.error, bad: true });
    await rebuild(robotId, "Rebuilt.");
  };

  const commit = (name: string, only?: string, tick?: string[], update3d = false) =>
    startCommit(async () => {
      if (!draft) return;
      setCommitError(null);
      const r = await commitChanges(systemId, draft.id, new Date(draft.detectedAt).toISOString(), name, only, tick, update3d).catch(asError);
      if (r.error) return setCommitError(r.error);
      const rest = only ? draft.changes.filter((c) => c.key !== only) : [];
      if (!rest.length) {
        setOpen(false);
        setFound(null);
      } else setFound({ ...found, draft: { ...draft, changes: rest } });
      setNote({ text: r.message ?? "Committed." });
      // The part data for the export files; the 3D here, with its progress on the tile.
      afterPartsUpdate(systemId, router);
      if (r.rebuild) await rebuild(r.rebuild, r.message ?? "Committed.");
    });

  const busy = checking || committing || !!progress || cad.busy;
  const shownNote = cad.note ?? note;
  const sub =
    cad.status ??
    progress ??
    (checking
      ? "Checking Onshape for changes…"
      : committing
        ? "Committing…"
        : waiting && !open
          ? `${waiting} ${waiting === 1 ? "change" : "changes"} waiting: tap to commit`
          : (shownNote?.text ?? "Update the BOM or the CAD from Onshape"));
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => (draft ? (setCommitError(null), setOpen(true)) : setChoose(true))}
        className={tileClass("accent")}
      >
        <TileBody icon={busy ? "" : "⟳"} title={busy ? "Loading…" : "Update system"} sub={sub} subClass={shownNote?.bad && !busy ? "!text-rose-200" : ""} />
        {busy && <span className="absolute top-1/2 left-9 h-8 w-8 -translate-y-1/2 animate-spin rounded-full border-4 border-white/30 border-t-white" aria-hidden />}
      </button>

      <Dialog open={choose} onClose={() => setChoose(false)} title="Update system" width="w-[min(34rem,calc(100vw-2rem))]">
        <div className="grid gap-3 min-[420px]:grid-cols-2">
          <button type="button" className={tileClass("accent")} onClick={checkBom} {...costHint(CALL_COSTS.checkBom)}>
            <TileBody icon="☰" title="Update BOM" sub="Check Onshape and commit the BOM's next version" />
          </button>
          <button
            type="button"
            className={tileClass("violet")}
            {...costHint(CALL_COSTS.checkCad)}
            onClick={() => {
              setChoose(false);
              cad.check();
            }}
          >
            <TileBody icon="◈" title="Update CAD" sub="See what changed, then move the 3D views and the CAD version tree to now" />
          </button>
        </div>
      </Dialog>

      {cad.dialog}

      <RebuildDialog open={upToDate} onClose={() => setUpToDate(false)} onRebuild={() => void rebuildAnyway()} text="Nothing changed in Onshape since the BOM's last version." />

      {draft && (
        <CommitWindow
          key={draft.id + String(draft.detectedAt)}
          open={open}
          onClose={() => setOpen(false)}
          systemId={systemId}
          draft={draft}
          thumbs={found?.thumbs ?? {}}
          canCommit
          committing={committing}
          error={commitError}
          onCommit={commit}
          comments={found?.comments}
        />
      )}
    </>
  );
}
