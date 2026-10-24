"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { checkForChanges, commitChanges } from "@/app/(app)/versions-actions";
import { useEditMode } from "@/components/shell/ModeContext";
import type { Draft } from "@/lib/versions/detect";
import { MODEL_STALE_EVENT } from "@/components/dashboard/modelEvents";
import { CommitWindow } from "./CommitWindow";

type ThumbRound = { fetched: number; pending: number; calls: number; failed?: number; error?: string } | { error: string };

// Update System (plan/system-versioning.md §4, §7): checks the Manufacture assembly for
// changes and opens the Commit window when there are any. Changes found by the background
// check wait behind the "changes waiting" badge, in View mode too (read-only there). Opened from
// the Onshape panel (?check=1), it checks by itself.
export function UpdateSystem({
  systemId,
  draft: initial,
  lastSyncedAt,
  thumbs,
}: {
  systemId: string;
  draft: Draft | null;
  lastSyncedAt: Date | null;
  thumbs: Record<string, string | null>;
}) {
  const router = useRouter();
  const edit = useEditMode();
  const params = useSearchParams();
  const pathname = usePathname();
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [committing, startCommit] = useTransition();

  // A newer server draft (the page's own refresh found changes) replaces the one shown.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setDraft(initial);
  }

  const check = (quick: boolean) =>
    startCheck(async () => {
      setMessage(null);
      setError(null);
      const r = await checkForChanges(systemId, quick);
      if (r.error) return setError(r.error);
      setDraft(r.draft ?? null);
      if (r.draft) {
        setCommitError(null);
        setOpen(true);
      } else if (!quick) setMessage(`Up to date with Onshape (${r.calls} Onshape calls).`);
    });

  const autoChecked = useRef(false);
  useEffect(() => {
    if (params.get("check") !== "1" || autoChecked.current) return;
    autoChecked.current = true;
    router.replace(pathname, { scroll: false });
    check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when opened from the Onshape panel
  }, [params]);

  async function fetchThumbnails() {
    for (let round = 0; round < 10; round++) {
      const res = await fetch(`/api/systems/${systemId}/thumbnails`, { method: "POST" }).catch(() => null);
      const r = ((await res?.json().catch(() => null)) ?? { error: "Thumbnails stopped." }) as ThumbRound;
      if ("error" in r && !("fetched" in r)) return;
      const t = r as Exclude<ThumbRound, { error: string }>;
      if (t.fetched) router.refresh();
      if (!t.pending || !t.fetched) return;
    }
  }

  const commit = (name: string) =>
    startCommit(async () => {
      if (!draft) return;
      setCommitError(null);
      const r = await commitChanges(systemId, draft.id, new Date(draft.detectedAt).toISOString(), name);
      if (r.error) return setCommitError(r.error);
      setOpen(false);
      setDraft(null);
      setMessage(r.message ?? null);
      // Outside the transition, so the committed BOM shows now rather than when they finish:
      // new thumbnails, and the 3D model rebuilt from the assembly (RobotViewer listens).
      setTimeout(() => {
        window.dispatchEvent(new Event(MODEL_STALE_EVENT));
        void fetchThumbnails();
      });
    });

  const waiting = draft?.changes.length ?? 0;
  if (!edit && !draft) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {edit && (
        <button
          className="btn"
          disabled={checking || committing}
          title="Check the Onshape assembly for changed, added and removed parts. Nothing reaches the BOM until you commit."
          onClick={() => check(false)}
        >
          {checking ? "Checking Onshape…" : "Update System"}
        </button>
      )}
      {draft && (
        <button
          type="button"
          onClick={() => {
            setCommitError(null);
            setOpen(true);
          }}
          className="press inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-600 hover:border-amber-500/70"
        >
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="font-mono tabular-nums">{waiting}</span> {waiting === 1 ? "change" : "changes"} waiting in Onshape
        </button>
      )}
      {message && <span className="text-sm text-emerald-600">{message}</span>}
      {error && <span className="text-sm text-rose-600">{error}</span>}
      {!message && !error && !draft && lastSyncedAt && (
        <span className="text-xs text-subtle">Last committed {lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
      )}
      {draft && (
        <CommitWindow
          key={draft.id + String(draft.detectedAt)}
          open={open}
          onClose={() => setOpen(false)}
          draft={draft}
          thumbs={thumbs}
          canCommit={edit}
          committing={committing}
          error={commitError}
          onCommit={commit}
        />
      )}
    </div>
  );
}
