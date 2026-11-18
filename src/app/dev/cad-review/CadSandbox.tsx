"use client";

import { useEffect, useMemo, useState } from "react";
import { ReviewScreen, type ReviewPart } from "@/components/review/ReviewScreen";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { Anchor } from "@/lib/reviews/anchor";
import type { CommentStatus } from "@/lib/reviews/status";

const PEOPLE = ["Noa Levi", "Itay Cohen", "Maya Ben-David"];
const TEXTS = [
  "This plate is too thin around the bearing, go to 1/4\".",
  "The bolt here hits the belt when the arm is down.",
  "Can we pocket this to save weight?",
  "Chain tensioner missing on this side.",
  "Check clearance to the bumper.",
];
const STATES: CommentStatus[] = ["open", "on_it", "open", "to_check", "done"];

// A comment on part `k`, pinned where that part sits.
function fake(i: number, k: string | null, name: string | null, systemId: string | null, systemName: string | null, at: [number, number, number] | null): ReviewComment {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    robotId: "sandbox",
    systemId,
    systemName,
    body: TEXTS[i % TEXTS.length],
    partKey: k,
    partName: name,
    onshapeVersionId: null,
    onshapeVersionName: null,
    state: STATES[i % STATES.length],
    onItAt: null,
    onItBy: STATES[i % STATES.length] === "on_it" ? PEOPLE[1] : null,
    createdAt: new Date(Date.now() - (10 - i) * 3600e3).toISOString(),
    author: PEOPLE[i % PEOPLE.length],
    authorId: `author-${i % PEOPLE.length}`,
    doneAt: null,
    doneBy: null,
    doneVersionId: null,
    approvedAt: null,
    approvedBy: null,
    rejectNote: null,
    rejectedAt: null,
    rejectedBy: null,
    snip: null,
    view: null,
    pin: at,
    anchor: null,
    model: "final",
    authorAvatar: null,
    editedAt: null,
    replies: [],
    version: null,
  } as ReviewComment;
}

export function CadSandbox() {
  const [data, setData] = useState<{ model: ViewerModel; names: Record<string, string> } | null>(null);
  useEffect(() => {
    fetch("/api/dev/viewer")
      .then((r) => r.json())
      .then(setData);
  }, []);
  const { parts, systems, comments } = useMemo(() => {
  if (!data) return { parts: [] as ReviewPart[], systems: [] as { id: string; name: string }[], comments: [] as ReviewComment[] };
    const groups = data.model.groups ?? [];
    const systems = groups.map((g) => ({ id: g.systemIds[0], name: g.name }));
    const seen = new Map<string, { k: string; t: number[]; g: number }>();
    for (const p of data.model.placements) if (!seen.has(p.k)) seen.set(p.k, { k: p.k, t: p.t, g: p.g ?? 0 });
    const list = [...seen.values()];
    const parts: ReviewPart[] = list.map((p, i) => ({ id: `part-${i}`, key: p.k, name: data.names[p.k] ?? p.k, systemId: systems[p.g]?.id ?? null }));
    const comments = list.slice(0, 8).map((p, i) => {
      const sys = i % 4 === 3 ? null : systems[p.g];
      return fake(i, p.k, data.names[p.k] ?? null, sys?.id ?? null, sys?.name ?? null, [p.t[3] * 1000, p.t[7] * 1000, p.t[11] * 1000]);
    });
    return { parts, systems, comments };
  }, [data]);
  // `window.sandboxAnchor(i, cadTools.pickAnchor())` links fake comment i to the newest pick.
  const [anchors, setAnchors] = useState<Record<number, Anchor>>({});
  useEffect(() => {
    (window as unknown as { sandboxAnchor?: (i: number, a: Anchor) => void }).sandboxAnchor = (i, a) => setAnchors((m) => ({ ...m, [i]: a }));
  }, []);
  const shown = useMemo(() => comments.map((c, i) => (anchors[i] ? { ...c, anchor: anchors[i], partKey: anchors[i].key, pin: anchors[i].at } : c)), [comments, anchors]);
  if (!data) return <p className="p-6 text-sm text-muted">Loading the sandbox…</p>;
  return (
    <div className="p-4 md:p-6">
      <ReviewScreen
        robotId="sandbox"
        title="Sandbox robot"
        modelUrl="/api/dev/viewer"
        builtAt="sandbox"
        parts={parts}
        comments={shown}
        target={{ systems }}
        me={{ id: "author-0", isAdmin: true, isMentor: true }}
        canTick
        canApprove
        onIsolate={() => {}}
        panel={() => <p className="text-xs text-muted">The version tree shows here on the real CAD page.</p>}
      />
    </div>
  );
}
