"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitChanges, updateToLatest } from "@/app/(app)/versions-actions";
import { Popover } from "@/components/bom/Popover";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import type { OutdatedTag as OutdatedInfo, PartVersionTag, VersionTags } from "@/lib/versions/tags";
import { afterPartsUpdate } from "./afterUpdate";
import { OPEN_COMMIT_EVENT, OPEN_VERSIONS_EVENT } from "./events";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const versionLabel = (t: PartVersionTag) => `${t.label}${t.name && t.name !== t.label ? ` · ${t.name}` : ""}`;

// A part card's version tag (plan/system-versioning.md §7): a quiet "Up to date" pill with the
// system's version (opening to the version the part itself last changed in), or a red
// "Outdated" one when other parts of its change were committed without it, or a Revert held it
// behind the latest version. Outdated opens a window with the update it missed (which opens the
// Commit or Versions window on top) and Update, which brings just this part up to date.
export function VersionTag({ partId, tags, manual = false }: { partId: string; tags: VersionTags; manual?: boolean }) {
  const tag = tags.parts[partId];
  const outdated = tags.outdated[partId];
  if (outdated) return <OutdatedTag partId={partId} tag={tag} tags={tags} outdated={outdated} />;
  const current = tags.current;
  if (!current) return null;
  return (
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <Popover
        hideCaret
        triggerClassName="inline-flex h-6 items-center gap-1 rounded-full border border-sky-400/50 bg-white/90 px-2 text-[11px] font-semibold text-sky-600 shadow-sm backdrop-blur-md hover:border-sky-400"
        trigger={
          <>
            <CheckIcon className="h-3 w-3" />
            <span className="font-mono tabular-nums">{current.label}</span>
          </>
        }
      >
        {() => (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-fg">
              Up to date <span className="font-normal text-subtle">· system on {current.label}</span>
            </p>
            <div>
              <p className="label">Last updated</p>
              {manual ? (
                <p className="text-muted">Added by hand, not from Onshape</p>
              ) : tag ? (
                <>
                  <p className="text-fg">{versionLabel(tag)}</p>
                  <p className="text-muted tabular-nums">
                    {when(tag.at)}
                    {tag.by && <> by {tag.by}</>}
                  </p>
                </>
              ) : (
                <p className="text-muted">Before version control</p>
              )}
            </div>
          </div>
        )}
      </Popover>
    </span>
  );
}

function OutdatedTag({ partId, tag, tags, outdated }: { partId: string; tag: PartVersionTag | undefined; tags: VersionTags; outdated: OutdatedInfo }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edit = useCan("sync");
  const router = useRouter();
  const update = () =>
    start(async () => {
      setError(null);
      const r = outdated.key
        ? tags.draft
          ? await commitChanges(tags.systemId, tags.draft.id, tags.draft.detectedAt, "", outdated.key)
          : { error: "These changes were already committed. Reload the page." }
        : await updateToLatest(tags.systemId, partId);
      if (r.error) return setError(r.error);
      setOpen(false);
      afterPartsUpdate(tags.systemId, router);
    });
  return (
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex h-6 items-center gap-1 rounded-full border border-rose-400 bg-rose-500/90 px-2 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md hover:bg-rose-500"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
        Outdated
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Outdated">
        <div className="space-y-3 text-sm">
          <div>
            <p className="label">Last updated</p>
            <p className="text-fg tabular-nums">
              {tag ? (
                <>
                  {when(tag.at)} <span className="text-subtle">· {versionLabel(tag)}</span>
                </>
              ) : (
                "Before version control"
              )}
            </p>
          </div>
          <div>
            <p className="label">Missed update</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(outdated.key ? OPEN_COMMIT_EVENT : OPEN_VERSIONS_EVENT))}
              className="card-interactive flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate tabular-nums">{outdated.missed ? `${when(outdated.missed.at)} · ${versionLabel(outdated.missed)}` : "Changes in Onshape"}</span>
              <Icon name="arrow" className="h-4 w-4 text-subtle" />
            </button>
          </div>
          {error && <p className="text-rose-600">{error}</p>}
          {edit ? (
            <button type="button" className="btn-primary w-full justify-center" disabled={pending} onClick={update}>
              {pending ? "Updating…" : "Update"}
            </button>
          ) : (
            <p className="text-xs text-subtle">The CAD Team updates parts from Onshape.</p>
          )}
        </div>
      </Dialog>
    </span>
  );
}
