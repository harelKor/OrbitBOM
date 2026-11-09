"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addReviewComment } from "@/app/(app)/review-comments-actions";
import { OpenComment, TreeComment, WaitingComment } from "@/components/review/Comments";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { PanelPlace, PanelVersion } from "@/lib/reviews/panelVersion";

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

  const partsHere = parts.filter((p) => p.systemId === systemId);
  const part = partsHere.find((p) => p.key === partKey) ?? null;
  const open = comments.filter((c) => c.state === "open");
  const waiting = comments.filter((c) => c.state === "done");
  const approved = comments.filter((c) => c.state === "approved").reverse();
  const where = !fixedSystem;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const v = systemId && version.data?.version ? version.data.version : null;
      const r = await addReviewComment(robotId, systemId, body, part && { key: part.key, name: part.name }, v);
      if (r.error) return setError(r.error);
      setBody("");
      setPartKey("");
      router.refresh();
    });
  };

  return (
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

      <section className="space-y-1">
        <h2 className="label">Open · {open.length}</h2>
        {open.length ? (
          <ul>
            {open.map((c) => (
              <OpenComment key={c.id} c={c} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} where={where} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No open comments.</p>
        )}
      </section>
      {waiting.length > 0 && (
        <section className="space-y-1">
          <h2 className="label">Waiting for a mentor · {waiting.length}</h2>
          <ul>
            {waiting.map((c) => (
              <WaitingComment key={c.id} c={c} isMentor={canApprove} canTick={canTick} where={where} />
            ))}
          </ul>
        </section>
      )}
      {approved.length > 0 && (
        <details>
          <summary className="label cursor-pointer pointer-coarse:min-h-9">Approved · {approved.length}</summary>
          <ul className="mt-1">
            {approved.map((c) => (
              <TreeComment key={c.id} c={c} />
            ))}
          </ul>
        </details>
      )}
    </div>
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
