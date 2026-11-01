"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { checkForChanges, commitChanges, revertToVersion } from "@/app/(app)/versions-actions";
import { useCan } from "@/components/shell/ModeContext";
import type { Draft } from "@/lib/versions/detect";
import { PARTS_UPDATING_EVENT, afterPartsUpdate } from "./afterUpdate";
import { CommitWindow } from "./CommitWindow";
import { CHECK_SYSTEM_EVENT, OPEN_COMMIT_EVENT } from "./events";

// Update System (plan/system-versioning.md §4, §7): checks the Manufacture assembly for
// changes and opens the Commit window when there are any. Changes found by the background
// check wait behind the "changes waiting" badge, in View mode too (read-only there). Opened from
// the Onshape panel (?check=1), it checks by itself. On phones its buttons hide and the Versions
// window's Update system runs the check (CHECK_SYSTEM_EVENT).
export function UpdateSystem({
  systemId,
  draft: initial,
  lastSyncedAt,
  thumbs,
  latest,
}: {
  systemId: string;
  draft: Draft | null;
  lastSyncedAt: Date | null;
  thumbs: Record<string, string | null>;
  latest: { id: string; label: string } | null; // set while a Revert holds the system behind it
}) {
  const router = useRouter();
  const edit = useCan("sync");
  const params = useSearchParams();
  const pathname = usePathname();
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [committing, startCommit] = useTransition();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onUpdating = (e: Event) => setLoading((e as CustomEvent<boolean>).detail);
    window.addEventListener(PARTS_UPDATING_EVENT, onUpdating);
    return () => window.removeEventListener(PARTS_UPDATING_EVENT, onUpdating);
  }, []);

  const backToLatest = () =>
    startCommit(async () => {
      if (!latest) return;
      setMessage(null);
      setError(null);
      const r = await revertToVersion(systemId, latest.id);
      if (r.error) return setError(r.error);
      setMessage(`Back on ${latest.label}.`);
      afterPartsUpdate(systemId, router);
    });

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
      if (r.applied) afterPartsUpdate(systemId, router);
      if (r.draft) {
        setCommitError(null);
        setOpen(true);
      } else if (!quick) setMessage(`Up to date with Onshape (${r.calls} Onshape calls).`);
    });

  // An Outdated tag's missed update opens this window.
  useEffect(() => {
    const onOpen = () => {
      setCommitError(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_COMMIT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMIT_EVENT, onOpen);
  }, []);

  // The Versions window's Update system (phones) runs the same check.
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });
  useEffect(() => {
    const onCheck = () => checkRef.current(false);
    window.addEventListener(CHECK_SYSTEM_EVENT, onCheck);
    return () => window.removeEventListener(CHECK_SYSTEM_EVENT, onCheck);
  }, []);

  const autoChecked = useRef(false);
  useEffect(() => {
    if (params.get("check") !== "1" || autoChecked.current) return;
    autoChecked.current = true;
    router.replace(pathname, { scroll: false });
    check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when opened from the Onshape panel
  }, [params]);

  const commit = (name: string, only?: string) =>
    startCommit(async () => {
      if (!draft) return;
      setCommitError(null);
      const r = await commitChanges(systemId, draft.id, new Date(draft.detectedAt).toISOString(), name, only);
      if (r.error) return setCommitError(r.error);
      const rest = only ? draft.changes.filter((c) => c.key !== only) : [];
      if (!rest.length) {
        setOpen(false);
        setDraft(null);
      } else setDraft({ ...draft, changes: rest });
      setMessage(r.message ?? null);
      afterPartsUpdate(systemId, router);
    });

  const waiting = draft?.changes.length ?? 0;
  if (!edit && !draft && !loading) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {edit && latest && (
        <button
          className="btn-primary max-sm:hidden"
          disabled={committing}
          title="Put every part back on the latest version. Reverting to an older version is in Versions."
          onClick={backToLatest}
        >
          {committing ? "Updating…" : `Back to latest (${latest.label})`}
        </button>
      )}
      {edit && !latest && (
        <button
          className="btn max-sm:hidden"
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
      {checking && <span className="animate-pulse text-sm text-subtle sm:hidden">Checking Onshape…</span>}
      {message && <span className="text-sm text-emerald-600">{message}</span>}
      {loading && <span className="animate-pulse text-sm text-subtle">Loading the new thumbnails and 3D model…</span>}
      {error && <span className="text-sm text-rose-600">{error}</span>}
      {!message && !error && !draft && lastSyncedAt && (
        <span className="text-xs text-subtle max-sm:hidden">Last committed {lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
      )}
      {draft && (
        <CommitWindow
          key={draft.id + String(draft.detectedAt)}
          open={open}
          onClose={() => setOpen(false)}
          systemId={systemId}
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
