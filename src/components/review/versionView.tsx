"use client";

import { createContext, useEffect, useState } from "react";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { ModelKind } from "@/components/dashboard/ModelToggle";
import type { FrozenRef } from "@/lib/reviews/tree";
import { OLD } from "@/lib/versions/versionDiff";

// Visiting and comparing versions on the CAD page (plan/cad-versions.md, Harel 2026-11-17). A
// version is drawn from its kept snapshot (GET /api/robots/<id>/model/version), and the version
// before it is loaded beside it under OLD + key: hidden while visiting (it tells which parts
// changed), shown and faded against it while comparing.

export type Entry = { owner: string; ref: FrozenRef }; // owner: a system's id, or "robot"
export type VersionPick = { key: string; label: string; at: string | null; entries: Entry[] };
export type VersionTarget =
  // `b`: the version before (its changes colour the parts); `commit`: open its Commit window.
  | { mode: "visit"; a: VersionPick; b: VersionPick | null; commit?: boolean }
  // `a` the newer, `b` the older; `only`: just these parts (Compare to last version).
  | { mode: "compare"; a: VersionPick; b: VersionPick; only?: string[] };

export type VersionCtl = {
  target: VersionTarget | null;
  show: (t: VersionTarget | null) => void;
  kind: ModelKind;
  robotId: string;
  canDelete: boolean;
};
export const VersionContext = createContext<VersionCtl | null>(null);

type Answer = { state: "ready"; model: ViewerModel & { names: Record<string, string>; groups: { systemIds: string[]; name: string }[] } } | { state: "missing"; why: "plan" | "files"; entry: number } | { state: "error"; error: string };

export type VersionLoad =
  | { state: "loading" }
  | { state: "ready"; model: ViewerModel & { keys: string[] }; names: Record<string, string>; newer: number[]; older: number[] }
  | { state: "missing"; pick: VersionPick; entry: Entry }
  | { state: "error"; error: string };

const query = (kind: ModelKind, entries: Entry[]) => new URLSearchParams([...(kind === "basepart" ? [["model", "basepart"]] : []), ...entries.map((e) => ["e", `${e.owner}|${e.ref.wvm}|${e.ref.wvmid}`])]).toString();

async function fetchPick(robotId: string, kind: ModelKind, pick: VersionPick): Promise<Answer> {
  const res = await fetch(`/api/robots/${robotId}/model/version?${query(kind, pick.entries)}`);
  return (await res.json().catch(() => ({ state: "error", error: `The version couldn't load (${res.status}).` }))) as Answer;
}

// The two versions as one model: `a`'s groups first, then `b`'s with OLD keys.
function merge(a: Extract<Answer, { state: "ready" }>["model"], b: Extract<Answer, { state: "ready" }>["model"] | null) {
  const studios = [...a.studios];
  const keys = [...(a.keys ?? [])].map((k) => k ?? "");
  const at = new Map(keys.map((k, i) => [k, i]));
  const placements = a.placements.map((p) => ({ ...p, g: p.g ?? 0 }));
  const groups = [...a.groups];
  const names = { ...a.names };
  const newer = a.groups.map((_, i) => i);
  const older: number[] = [];
  if (b) {
    const offset = groups.length;
    const index = (b.keys ?? []).map((k, i) => {
      const key = k ?? "";
      let j = key ? at.get(key) : undefined;
      if (j === undefined) {
        j = studios.push(b.studios[i]) - 1;
        keys.push(key);
        if (key) at.set(key, j);
      }
      return j;
    });
    for (const p of b.placements) placements.push({ s: index[p.s], k: OLD + p.k, t: p.t, g: (p.g ?? 0) + offset });
    b.groups.forEach((g, i) => {
      groups.push({ ...g, name: `${g.name} (older)` });
      older.push(offset + i);
    });
    for (const [k, n] of Object.entries(b.names)) names[k] ??= n;
  }
  return { model: { studios, keys, placements, groups, sketches: a.sketches, sketchesHidden: true }, names, newer, older };
}

export function useVersionModel(robotId: string, kind: ModelKind, target: VersionTarget | null, attempt: number): VersionLoad | null {
  const [load, setLoad] = useState<VersionLoad | null>(null);
  const a = target?.a;
  const b = target?.b ?? null;
  const sig = target ? `${kind}|${a!.key}|${b?.key ?? ""}|${attempt}` : "";
  useEffect(() => {
    if (!a) return;
    let live = true;
    void Promise.resolve().then(() => live && setLoad({ state: "loading" }));
    Promise.all([fetchPick(robotId, kind, a), b ? fetchPick(robotId, kind, b) : Promise.resolve(null)])
      .then(([ra, rb]) => {
        if (!live) return;
        for (const [r, pick] of [
          [ra, a],
          [rb, b],
        ] as const) {
          if (!r || !pick) continue;
          if (r.state === "error") return setLoad({ state: "error", error: r.error });
          if (r.state === "missing") return setLoad({ state: "missing", pick, entry: pick.entries[r.entry] });
        }
        if (ra.state !== "ready") return;
        setLoad({ state: "ready", ...merge(ra.model, rb?.state === "ready" ? rb.model : null) });
      })
      .catch(() => live && setLoad({ state: "error", error: "The version couldn't load." }));
    return () => {
      live = false;
    };
    // `sig` names everything the fetch depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return target ? load : null;
}

// Builds a version kept nobody yet, a step at a time (POST), on the member's Onshape account.
export async function buildVersion(robotId: string, kind: ModelKind, entry: Entry, onProgress: (text: string) => void): Promise<{ ok: true; calls: number } | { ok: false; error: string }> {
  let calls = 0;
  for (let round = 0; round < 30; round++) {
    const res = await fetch(`/api/robots/${robotId}/model/version?${query(kind, [entry])}`, { method: "POST" });
    const r = (await res.json().catch(() => ({ error: `The export failed (${res.status}).` }))) as { state?: "done" | "working"; done?: number; total?: number; calls?: number; error?: string };
    if (r.error) return { ok: false, error: r.error };
    calls += r.calls ?? 0;
    if (r.state === "done") return { ok: true, calls };
    onProgress(`Exporting part studios ${r.done}/${r.total}…`);
  }
  return { ok: false, error: "Onshape is still exporting. Press Build again to continue." };
}
