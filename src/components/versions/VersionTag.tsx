"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitChanges } from "@/app/(app)/versions-actions";
import { Popover } from "@/components/bom/Popover";
import { Dialog } from "@/components/Dialog";
import { useEditMode } from "@/components/shell/ModeContext";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import type { PartVersionTag, VersionTags } from "@/lib/versions/tags";
import { OPEN_COMMIT_EVENT } from "./events";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const versionLabel = (t: PartVersionTag) => `v${t.seq}${t.name ? ` · ${t.name}` : ""}`;

// A part card's version tag (plan/system-versioning.md §7): a quiet "Up to date" pill with when
// and by whom the part was last committed, or a red "Outdated" one when other parts of its
// change were committed without it. Outdated opens a window with the update it missed (which
// opens the Commit window on top) and Update, which commits just this part.
export function VersionTag({ partId, tags }: { partId: string; tags: VersionTags }) {
  const tag = tags.parts[partId];
  const outdatedKey = tags.outdated[partId];
  if (outdatedKey) return <OutdatedTag tag={tag} tags={tags} changeKey={outdatedKey} />;
  if (!tag) return null;
  return (
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <Popover
        hideCaret
        triggerClassName="inline-flex h-6 items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 text-[11px] font-semibold text-sky-500 hover:border-sky-400/60"
        trigger={
          <>
            <CheckIcon className="h-3 w-3" />
            <span className="font-mono tabular-nums">v{tag.seq}</span>
          </>
        }
      >
        {() => (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-fg">Up to date</p>
            <p className="text-muted">
              Updated <span className="tabular-nums">{when(tag.at)}</span>
              {tag.by && <> by {tag.by}</>}
            </p>
            <p className="text-subtle">{versionLabel(tag)}</p>
          </div>
        )}
      </Popover>
    </span>
  );
}

function OutdatedTag({ tag, tags, changeKey }: { tag: PartVersionTag | undefined; tags: VersionTags; changeKey: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edit = useEditMode();
  const router = useRouter();
  const update = () =>
    start(async () => {
      if (!tags.draft) return;
      setError(null);
      const r = await commitChanges(tags.systemId, tags.draft.id, tags.draft.detectedAt, "", changeKey);
      if (r.error) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  return (
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex h-6 items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 text-[11px] font-semibold text-rose-500 hover:border-rose-500/70"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
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
              onClick={() => window.dispatchEvent(new Event(OPEN_COMMIT_EVENT))}
              className="card-interactive flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate tabular-nums">{tags.missed ? `${when(tags.missed.at)} · ${versionLabel(tags.missed)}` : "Changes in Onshape"}</span>
              <Icon name="arrow" className="h-4 w-4 text-subtle" />
            </button>
          </div>
          {error && <p className="text-rose-600">{error}</p>}
          {edit ? (
            <button type="button" className="btn-primary w-full justify-center" disabled={pending} onClick={update}>
              {pending ? "Updating…" : "Update"}
            </button>
          ) : (
            <p className="text-xs text-subtle">Switch to Edit to update this part.</p>
          )}
        </div>
      </Dialog>
    </span>
  );
}
