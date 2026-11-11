"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitChanges } from "@/app/(app)/versions-actions";
import { afterPartsUpdate } from "@/components/versions/afterUpdate";
import { CommitWindow } from "@/components/versions/CommitWindow";
import { panelCheckSystem, type PanelCheck } from "./update-actions";
import { tileClass, TileBody } from "./tiles";

// Update system in the Onshape panel (Harel, 2026-11-11): the tile itself turns to Loading…
// while Onshape is checked and the Commit window opens right there. Members don't browse the app
// from inside Onshape, so it never goes to the system page.
export function UpdateTile({ systemId }: { systemId: string }) {
  const router = useRouter();
  const [checking, startCheck] = useTransition();
  const [committing, startCommit] = useTransition();
  const [found, setFound] = useState<PanelCheck | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const draft = found?.draft ?? null;
  const waiting = draft?.changes.length ?? 0;

  const check = () =>
    startCheck(async () => {
      setNote(null);
      const r = await panelCheckSystem(systemId);
      if (r.error) return setNote({ text: r.error, bad: true });
      setFound(r);
      if (r.draft) {
        setCommitError(null);
        setOpen(true);
      } else setNote({ text: "Up to date with Onshape" });
    });

  const commit = (name: string, only?: string, tick?: string[]) =>
    startCommit(async () => {
      if (!draft) return;
      setCommitError(null);
      const r = await commitChanges(systemId, draft.id, new Date(draft.detectedAt).toISOString(), name, only, tick);
      if (r.error) return setCommitError(r.error);
      const rest = only ? draft.changes.filter((c) => c.key !== only) : [];
      if (!rest.length) {
        setOpen(false);
        setFound(null);
      } else setFound({ ...found, draft: { ...draft, changes: rest } });
      setNote({ text: r.message ?? "Committed." });
      afterPartsUpdate(systemId, router);
    });

  const busy = checking || committing;
  const sub = checking
    ? "Checking Onshape for changes…"
    : committing
      ? "Committing…"
      : waiting && !open
        ? `${waiting} ${waiting === 1 ? "change" : "changes"} waiting: tap to commit`
        : (note?.text ?? "Check Onshape for changes and commit them");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => (draft ? (setCommitError(null), setOpen(true)) : check())}
        className={tileClass("accent")}
      >
        <TileBody icon={busy ? "" : "⟳"} title={busy ? "Loading…" : "Update system"} sub={sub} subClass={note?.bad && !busy ? "!text-rose-200" : ""} />
        {busy && <span className="absolute top-1/2 left-9 h-8 w-8 -translate-y-1/2 animate-spin rounded-full border-4 border-white/30 border-t-white" aria-hidden />}
      </button>
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
