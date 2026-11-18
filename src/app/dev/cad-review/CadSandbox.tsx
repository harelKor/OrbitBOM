"use client";

import { useEffect, useMemo, useState } from "react";
import { ReviewScreen, type ReviewPart } from "@/components/review/ReviewScreen";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { Anchor } from "@/lib/reviews/anchor";
import type { DesignReview } from "@/lib/reviews/designReviews";
import type { CommentStatus } from "@/lib/reviews/status";

const PEOPLE = ["Noa Levi", "Itay Cohen", "Maya Ben-David"];
const TEXTS = [
  "This plate is too thin around the bearing, go to 1/4\".",
  "The bolt here hits the belt when the arm is down.",
  "Can we pocket this to save weight?",
  "Chain tensioner missing on this side.",
  "Check clearance to the bumper.",
];
// Two made-up Design Reviews: DR 2 open (the panel's corner glow), DR 1 finished.
const REVIEWS: DesignReview[] = [
  { id: "dr-2", seq: 2, name: "DR 2", wholeRobot: true, systems: [], state: "Whole robot before district 2: shooter hood v3, new intake rollers. Check weight and bumper clearances.", version: "R4", finishVersion: null, startedBy: "Noa Levi", startedAt: new Date(Date.now() - 2 * 3600e3).toISOString(), finishedBy: null, finishedAt: null, open: true },
  { id: "dr-1", seq: 1, name: "DR 1", wholeRobot: false, systems: [{ id: "drive", name: "Drivetrain" }], state: "Drivetrain at 80%: bellypan and rails done, no electronics yet.", version: null, finishVersion: "R3", startedBy: "Itay Cohen", startedAt: new Date(Date.now() - 5 * 86400e3).toISOString(), finishedBy: "Itay Cohen", finishedAt: new Date(Date.now() - 4 * 86400e3).toISOString(), open: false },
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
    anchors: null,
    designReview: i % 3 === 0 ? { id: "dr-2", name: "DR 2", version: "R4", state: REVIEWS[0].state, open: true } : i % 3 === 1 ? { id: "dr-1", name: "DR 1", version: null, state: REVIEWS[1].state, open: false } : null,
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
  const [closed] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("closed") === "1");
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
        // ?closed=1: no DR open (Start DR).
        reviews={{ list: closed ? REVIEWS.map((d) => ({ ...d, open: false })) : REVIEWS, nextVersion: 5, systems }}
        panel={() => <p className="text-xs text-muted">The version tree shows here on the real CAD page.</p>}
      />
    </div>
  );
}
