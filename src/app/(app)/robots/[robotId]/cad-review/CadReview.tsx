"use client";

import { isActive } from "@/lib/reviews/status";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ReviewScreen, type ReviewPart } from "@/components/review/ReviewScreen";
import { VersionTree } from "@/components/review/VersionTree";
import type { Entry, VersionPick } from "@/components/review/versionView";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/ui/Toaster";
import type { FrozenRef } from "@/lib/reviews/tree";
import { flatVersions, previousOf, sameRef } from "@/lib/reviews/versionList";
import { makeRobotVersion } from "./versionActions";
import { UpdateSystem } from "@/components/versions/UpdateSystem";
import type { RobotReview } from "@/lib/data/cadReview";
import type { Draft } from "@/lib/versions/detect";
import { rememberModel, startModel, type ModelKind } from "@/components/dashboard/ModelToggle";

export type IsolatedExtras = {
  systemId: string;
  assemblyUrl: string | null;
  lastSyncedAt: Date | null;
  draft: Draft | null;
  latest: { id: string; label: string } | null;
  partThumbs: Record<string, string | null>;
};

// CAD's page (Harel, 2026-11-09 and 2026-11-10): the whole robot. Its panel: a section per system
// (no Robot comments section since 2026-11-17: they're in the comments column) (its picture, Isolate, and its version tree when unfolded).
// Isolate scopes the page to that system the way its own page did: only its parts in 3D, its
// comments, Update system, its version tree and the Changes colours, with Whole robot to go back.
// The page shows it at once and the address (?system=) follows, so a reload or a shared link keeps it.
export function CadReview({
  robotId,
  robotName,
  review,
  parts,
  thumbs,
  builtAt,
  isolatedId,
  extras,
  me,
  canTick,
  canApprove,
  canSync,
  canCheck,
  canManage,
  hasBasepart,
  initialModel,
}: {
  robotId: string;
  robotName: string;
  review: RobotReview;
  parts: ReviewPart[];
  thumbs: Record<string, string | null>;
  builtAt: Record<ModelKind, string | null>; // each 3D model's build time
  isolatedId: string | null;
  extras: IsolatedExtras | null;
  me: { id: string; isAdmin: boolean; isMentor: boolean; onshape: boolean };
  canTick: boolean;
  canApprove: boolean;
  canSync: boolean;
  canCheck: boolean; // run the Design check, set weights, mark overlaps fine
  canManage: boolean; // the Design check's limits
  hasBasepart: boolean; // a Basepart is linked (Harel, 2026-11-12)
  initialModel?: ModelKind;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Basepart | Final (Harel, 2026-11-12): the toggle once both exist; the address keeps the choice.
  const hasFinal = !!builtAt.final || !hasBasepart;
  const [kind, setKind] = useState<ModelKind>(() => startModel(initialModel, hasFinal, hasBasepart || !!builtAt.basepart));
  const models = {
    kind,
    both: hasFinal && (hasBasepart || !!builtAt.basepart),
    onKind: (k: ModelKind) => {
      setKind(k);
      rememberModel(k);
    },
  };
  const modelUrl = `/api/robots/${robotId}/model${kind === "basepart" ? "?model=basepart" : ""}`;
  // The isolated system: set at once on a tap, then kept in step with the address (Back, links).
  const [iso, setIso] = useState(isolatedId);
  const [seen, setSeen] = useState(isolatedId);
  if (seen !== isolatedId) {
    setSeen(isolatedId);
    setIso(isolatedId);
  }
  const isolate = (id: string | null) => {
    setIso(id);
    const q = new URLSearchParams({ ...(id ? { system: id } : {}), ...(kind === "basepart" ? { model: "basepart" } : {}) }).toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const byId = useMemo(() => new Map(review.comments.map((c) => [c.id, c])), [review.comments]);
  const systems = useMemo(() => review.systems.map((s) => ({ id: s.id, name: s.name })), [review.systems]);
  const sys = iso ? review.systems.find((s) => s.id === iso) : undefined;
  const sysParts = useMemo(() => (sys ? parts.filter((p) => p.systemId === sys.id) : parts), [parts, sys]);
  const extra = sys && extras?.systemId === sys.id ? extras : null;
  const check = useMemo(() => ({ systems, parts, canCheck, canManage }), [systems, parts, canCheck, canManage]);
  const canBuild = canSync && me.onshape;
  // What each model is on now: Compare's other side (Harel, 2026-11-17).
  const now = (owner: string, ref: FrozenRef | null | undefined): VersionPick | null => (ref ? { key: "current", label: "Current", at: null, entries: [{ owner, ref }] } : null);
  // The whole robot's own versions: each one every system at that moment.
  const robotEntries = useMemo(
    () => new Map(review.robotVersions.map((v) => [`rv:${v.id}`, v.systems.flatMap((x): Entry[] => (x.ref ? [{ owner: x.systemId, ref: x.ref }] : []))])),
    [review.robotVersions],
  );
  const robotNow = useMemo((): VersionPick | null => {
    const entries = review.systems.flatMap((x): Entry[] => (x.final && x.modelRef ? [{ owner: x.id, ref: x.modelRef }] : []));
    return entries.length ? { key: "current", label: "Current", at: null, entries } : null;
  }, [review.systems]);

  if (sys) {
    const comments = review.comments.filter((c) => c.systemId === sys.id);
    // Compare to last version (the Changes tab): the version the Final is on now and the one before.
    const list = flatVersions(sys.tree);
    const at = list.find((x) => sameRef(x.ref, sys.modelRef));
    const before = at ? previousOf(list, at.key) : null;
    const compareLast =
      kind === "final" && at?.ref && before?.ref
        ? { a: { key: at.key, label: at.label, at: at.at, entries: [{ owner: sys.id, ref: at.ref }] }, b: { key: before.key, label: before.label, at: before.at, entries: [{ owner: sys.id, ref: before.ref }] } }
        : null;
    return (
      <ReviewScreen
        key={kind}
        models={models}
        robotId={robotId}
        title={sys.name}
        back={{ label: `${robotName} · whole robot`, onClick: () => isolate(null) }}
        modelUrl={modelUrl}
        builtAt={builtAt[kind]}
        parts={sysParts}
        comments={comments}
        target={{ systemId: sys.id }}
        onlySystem={sys.id}
        check={check}
        me={me}
        canTick={canTick}
        canApprove={canApprove}
        changes={kind === "final" ? { label: sys.current?.label ?? null, list: sys.changes } : undefined}
        canBuild={canBuild}
        compareLast={compareLast}
        panel={(onFocus, open) => (
          <>
            {extra?.assemblyUrl && (canSync || extra.draft) && (
              <Suspense>
                <UpdateSystem
                  systemId={sys.id}
                  draft={extra.draft}
                  lastSyncedAt={extra.lastSyncedAt}
                  thumbs={extra.partThumbs}
                  latest={extra.latest}
                  comments={open.map((c) => ({ id: c.id, body: c.body, partName: c.partName, author: c.author, createdAt: c.createdAt }))}
                  phone
                />
              </Suspense>
            )}
            {/* The Basepart and the Final each have their own tree (Harel, 2026-11-13). */}
            {kind === "basepart" ? (
              <VersionTree
                tree={sys.basepart?.tree ?? []}
                comments={byId}
                onFocus={onFocus}
                empty="No Basepart updates yet. Update Basepart in the Onshape panel brings the first one."
                owner={{ systemId: sys.id }}
                did={sys.basepart?.treeDid ?? null}
                current={now(sys.id, sys.basepart?.modelRef)}
              />
            ) : (
              <VersionTree
                tree={sys.tree}
                comments={byId}
                onFocus={onFocus}
                refresh={canSync && me.onshape && sys.treeDid ? { systemId: sys.id, readAt: sys.treeReadAt } : null}
                owner={{ systemId: sys.id }}
                did={sys.treeDid}
                current={now(sys.id, sys.modelRef)}
              />
            )}
          </>
        )}
      />
    );
  }

  return (
    <ReviewScreen
      key={kind}
      models={models}
      robotId={robotId}
      title={robotName}
      modelUrl={modelUrl}
      builtAt={builtAt[kind]}
      parts={parts}
      comments={review.comments}
      target={{ systems }}
      onlySystem={null}
      onIsolate={isolate}
      check={check}
      me={me}
      canTick={canTick}
      canApprove={canApprove}
      canBuild={canBuild}
      panel={(onFocus) => (
        <div className="space-y-2">
          {/* The whole robot's own versions (Harel, 2026-11-17), its comments under them. */}
          {kind === "final" && (
            <Fold title="Whole robot" count={review.comments.filter((c) => !c.systemId && isActive(c.state)).length} initial>
              {canSync && <CreateRobotVersion robotId={robotId} next={(review.robotVersions[0]?.seq ?? 0) + 1} />}
              <VersionTree
                tree={review.robotTree}
                comments={byId}
                onFocus={onFocus}
                empty="No robot versions yet. Create version keeps every system as it is now."
                owner={{ robot: robotEntries }}
                current={robotNow}
              />
            </Fold>
          )}
          {kind === "basepart" && review.robotBasepart && (
            <Fold title="Robot Basepart" count={0}>
              <VersionTree
                tree={review.robotBasepart.tree}
                comments={byId}
                onFocus={onFocus}
                empty="No Basepart updates yet. Update Basepart in the Onshape panel brings the first one."
                owner={{ robotBasepart: true }}
                did={review.robotBasepart.treeDid}
                current={now("robot", review.robotBasepart.modelRef)}
              />
            </Fold>
          )}
          {review.systems
            .filter((s) => (kind === "basepart" ? !!s.basepart : s.final))
            .map((s) => {
              const open = review.comments.filter((c) => c.systemId === s.id && isActive(c.state)).length;
              return (
                <Fold key={s.id} title={s.name} count={open} thumb={thumbs[s.id] ?? null} onIsolate={() => isolate(s.id)}>
                  {kind === "basepart" ? (
                    <VersionTree
                      tree={s.basepart?.tree ?? []}
                      comments={byId}
                      onFocus={onFocus}
                      empty="No Basepart updates yet. Update Basepart in the Onshape panel brings the first one."
                      owner={{ systemId: s.id }}
                      did={s.basepart?.treeDid ?? null}
                      current={now(s.id, s.basepart?.modelRef)}
                    />
                  ) : (
                    <VersionTree tree={s.tree} comments={byId} onFocus={onFocus} owner={{ systemId: s.id }} did={s.treeDid} current={now(s.id, s.modelRef)} />
                  )}
                </Fold>
              );
            })}
        </div>
      )}
    />
  );
}

// A panel section behind its own button; a system's has its picture and Isolate (Harel, 2026-11-10).
function Fold({ title, count, thumb, onIsolate, initial = false, children }: { title: string; count: number; thumb?: string | null; onIsolate?: () => void; initial?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="rounded-lg border border-line">
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="press flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold text-fg hover:bg-raised active:scale-[0.98] pointer-coarse:min-h-11" aria-expanded={open}>
          {thumb !== undefined && (
            <span className="thumb-well flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" />
              ) : (
                <span className="text-[0.625rem] text-subtle">No picture</span>
              )}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {count > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 tabular-nums">{count} open</span>}
          <span className={`text-xs text-subtle ${open ? "" : "rotate-180"}`}>▴</span>
        </button>
        {onIsolate && (
          <button onClick={onIsolate} className="btn mr-2 h-8 shrink-0 px-2.5 text-xs active:scale-[0.98] pointer-coarse:h-9" title={`Show only ${title}`}>
            Isolate
          </button>
        )}
      </div>
      {open && <div className="border-t border-line p-2">{children}</div>}
    </section>
  );
}

// Create version on the whole robot (Harel, 2026-11-17): keeps every system's 3D model as it is now
// as "R<n>", with a name and a note. No Onshape calls.
function CreateRobotVersion({ robotId, next }: { robotId: string; next: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn mb-2 h-9 w-full justify-center text-sm active:scale-[0.98]" onClick={() => setOpen(true)}>
        + Create version
      </button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title="Create a robot version">
        <form
          className="space-y-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await makeRobotVersion(robotId, name, note);
            setBusy(false);
            if (r.error) return toast(r.error, true);
            toast(`${r.label} created`);
            setOpen(false);
            setName("");
            setNote("");
            router.refresh();
          }}
        >
          <p className="text-sm text-muted">Keeps every system&rsquo;s 3D model and BOM version as they are now, so the whole robot can be viewed and compared as it was.</p>
          <label className="block">
            <span className="label">Name</span>
            <input className="input" value={name} maxLength={120} placeholder={`R${next}`} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Note (optional)</span>
            <textarea className="input min-h-20 w-full" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What this version is: a competition, a design review…" />
          </label>
          <button className="btn-primary h-11 w-full justify-center" disabled={busy}>
            {busy ? "Creating…" : "Create version"}
          </button>
        </form>
      </Dialog>
    </>
  );
}
