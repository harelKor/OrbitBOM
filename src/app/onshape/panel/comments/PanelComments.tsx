"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { addReviewComment } from "@/app/(app)/review-comments-actions";
import { OpenComment, TreeComment, WaitingComment } from "@/components/review/Comments";
import { SnipEditor, SnipMe, SnipPicture, uploadSnip, type SnipDraft } from "@/components/review/Snip";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { PanelPlace, PanelVersion } from "@/lib/reviews/panelVersion";
import { SnipPaste, type Shot } from "./PanelSnip";

type Part = { key: string; name: string; systemId: string };

// Writing a comment from inside Onshape, and the comments already there. The comment goes on the
// Onshape version open in Onshape (or the design's newest one), which may be newer than the
// version the BOM is on: the CAD page's tree then shows it above, marked (Harel, 2026-11-09).
export function PanelComments({
  robotId,
  systemId: fixedSystem,
  systems,
  parts,
  comments,
  place,
  me,
  canTick,
  canApprove,
}: {
  robotId: string;
  systemId: string | null; // null: the robot's main assembly, where a system can be picked
  systems: { id: string; name: string }[];
  parts: Part[];
  comments: ReviewComment[];
  place: PanelPlace;
  me: { id: string; isAdmin: boolean };
  canTick: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(""); // "" = the whole robot
  const systemId = fixedSystem ?? (picked || null);
  const [partKey, setPartKey] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const version = useVersion(systemId, place);
  // Snip: pasted from the system's snipping tool, then the drawing window (Harel, 2026-11-10).
  const [snip, setSnip] = useState<SnipDraft | null>(null);
  const [drawing, setDrawing] = useState(false);
  const took = useCallback((s: Shot) => {
    setSnip({ ...s, strokes: [] });
    setDrawing(true);
  }, []);

  const partsHere = parts.filter((p) => p.systemId === systemId);
  const part = partsHere.find((p) => p.key === partKey) ?? null;
  // A section per system, the whole robot's comments first (Harel, 2026-11-11).
  const sections = sectionsOf(comments);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const v = systemId && version.data?.version ? version.data.version : null;
      let shotUp = null;
      if (snip) {
        const up = await uploadSnip(snip);
        if ("error" in up) return setError(up.error);
        shotUp = up.snip;
      }
      const r = await addReviewComment(robotId, systemId, body, part && { key: part.key, name: part.name }, v, shotUp);
      if (r.error) return setError(r.error);
      setBody("");
      setPartKey("");
      setSnip(null);
      router.refresh();
    });
  };

  return (
    <SnipMe.Provider value={me.id}>
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-2.5 rounded-lg border border-line bg-surface p-3">
        {!fixedSystem && (
          <select className="input w-full pointer-coarse:min-h-9" value={picked} onChange={(e) => (setPicked(e.target.value), setPartKey(""))} aria-label="Where the comment goes">
            <option value="">Whole robot</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {systemId && <VersionLine state={version} />}
        <textarea required value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} className="input min-h-24 w-full" placeholder="What should change?" />
        {snip ? (
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => setDrawing(true)} className="press w-36 shrink-0 overflow-hidden rounded border border-line hover:border-accent/60 active:scale-[0.98]" title="Draw on it">
              <SnipPicture src={snip.dataUrl} w={snip.w} h={snip.h} strokes={snip.strokes} />
            </button>
            <div className="flex flex-col gap-1 text-xs">
              <button type="button" onClick={() => setDrawing(true)} className="press text-left font-semibold text-accent-hover hover:underline pointer-coarse:min-h-9">
                Draw on it
              </button>
              <button type="button" onClick={() => setSnip(null)} className="press text-left text-muted hover:text-rose-500 pointer-coarse:min-h-9">
                Remove snip
              </button>
            </div>
          </div>
        ) : (
          <SnipPaste onShot={took} onError={setError} />
        )}
        {partsHere.length > 0 && (
          <select className="input w-full pointer-coarse:min-h-9" value={partKey} onChange={(e) => setPartKey(e.target.value)} aria-label="The part it's about">
            <option value="">Not about one part</option>
            {partsHere.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <button className="btn-primary h-10 w-full justify-center active:scale-[0.98]" disabled={pending || !body.trim() || (!!systemId && version.loading)}>
          {pending ? "Saving…" : systemId && version.loading ? "Finding the Onshape version…" : "Add comment"}
        </button>
      </form>

      {sections.length ? (
        sections.map((s) => <CommentSection key={s.id ?? "robot"} name={s.name} comments={s.comments} me={me} canTick={canTick} canApprove={canApprove} />)
      ) : (
        <p className="text-xs text-muted">No comments yet.</p>
      )}
      {drawing && snip && (
        <SnipEditor
          title="Snip"
          src={snip.dataUrl}
          w={snip.w}
          h={snip.h}
          initial={snip.strokes.map((l) => ({ ...l, by: me.id }))}
          me={me.id}
          isAuthor
          onClose={() => setDrawing(false)}
          onConfirm={(lines) => {
            setSnip({ ...snip, strokes: lines.map(({ c, s, p }) => ({ c, s, p })) });
            setDrawing(false);
          }}
        />
      )}
    </div>
    </SnipMe.Provider>
  );
}

type VersionState = { loading: boolean; data: PanelVersion | null; error: string | null };

// Asks the server which Onshape version this system's comments go on (it may read Onshape once).
function useVersion(systemId: string | null, place: PanelPlace): VersionState {
  const [state, setState] = useState<VersionState & { for: string | null }>({ for: null, loading: false, data: null, error: null });
  useEffect(() => {
    if (!systemId) return;
    let live = true;
    const q = new URLSearchParams({ systemId, did: place.did ?? "", wv: place.wv ?? "", wvId: place.wvId ?? "" });
    fetch(`/api/panel/version?${q}`)
      .then(async (res) => {
        const r = (await res.json().catch(() => ({ error: "Couldn't find the Onshape version." }))) as PanelVersion & { error?: string };
        if (live) setState({ for: systemId, loading: false, data: r.error ? null : r, error: r.error ?? null });
      })
      .catch(() => live && setState({ for: systemId, loading: false, data: null, error: "Couldn't find the Onshape version." }));
    return () => {
      live = false;
    };
  }, [systemId, place.did, place.wv, place.wvId]);
  // Until this system's answer is in, it's loading.
  return state.for === systemId ? state : { loading: !!systemId, data: null, error: null };
}

function VersionLine({ state }: { state: VersionState }) {
  if (state.loading) return <p className="text-xs text-muted">Finding the Onshape version…</p>;
  const v = state.data?.version;
  return (
    <div className="space-y-1 text-xs">
      {v ? (
        <p className="flex flex-wrap items-center gap-1.5 text-fg-2">
          On Onshape version <span className="font-mono font-semibold text-fg">{v.name || "(unnamed)"}</span>
          {state.data?.ahead && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600" title="Update system hasn't brought this version into the BOM yet">
              Newer than the BOM{state.data.bom ? ` (${state.data.bom})` : ""}
            </span>
          )}
        </p>
      ) : (
        <p className="text-muted">Not tied to an Onshape version: it goes where its date puts it.</p>
      )}
      {(state.data?.note || state.error) && <p className="text-amber-600">{state.data?.note ?? state.error}</p>}
    </div>
  );
}

type Section = { id: string | null; name: string; comments: ReviewComment[] };

function sectionsOf(comments: ReviewComment[]): Section[] {
  const by = new Map<string | null, Section>();
  for (const c of comments) {
    const s = by.get(c.systemId) ?? { id: c.systemId, name: c.systemId ? (c.systemName ?? "System") : "Whole robot", comments: [] };
    s.comments.push(c);
    by.set(c.systemId, s);
  }
  return [...by.values()].sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
}

// One system's comments, folded with a tap. Open while it has comments to act on; only approved
// ones start folded.
function CommentSection({ name, comments, me, canTick, canApprove }: { name: string; comments: ReviewComment[]; me: { id: string; isAdmin: boolean }; canTick: boolean; canApprove: boolean }) {
  const open = comments.filter((c) => c.state === "open");
  const waiting = comments.filter((c) => c.state === "done");
  const approved = comments.filter((c) => c.state === "approved").reverse();
  return (
    <details open={open.length + waiting.length > 0} className="group rounded-lg border border-line bg-surface">
      <summary className="press flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span className="text-xs text-subtle transition-transform group-open:rotate-90" aria-hidden>
          ▶
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-fg">{name}</span>
        {open.length > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 tabular-nums">{open.length} open</span>}
        {waiting.length > 0 && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-600 tabular-nums">{waiting.length} waiting</span>}
        {!open.length && !waiting.length && <span className="text-[11px] text-subtle tabular-nums">{approved.length} approved</span>}
      </summary>
      <div className="space-y-3 border-t border-line px-2 pt-2 pb-3">
        {open.length > 0 && (
          <ul>
            {open.map((c) => (
              <OpenComment key={c.id} c={c} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} />
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <div>
            <h3 className="label px-2">Waiting for a mentor · {waiting.length}</h3>
            <ul>
              {waiting.map((c) => (
                <WaitingComment key={c.id} c={c} isMentor={canApprove} canTick={canTick} />
              ))}
            </ul>
          </div>
        )}
        {approved.length > 0 && (
          <details>
            <summary className="label cursor-pointer px-2 pointer-coarse:min-h-9">Approved · {approved.length}</summary>
            <ul className="mt-1">
              {approved.map((c) => (
                <TreeComment key={c.id} c={c} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}
