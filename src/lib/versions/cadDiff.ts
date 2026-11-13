// What Update CAD / Update Basepart's Commit window lists (Harel, 2026-11-13): the parts added,
// removed, or whose count or Part Studio file changed between the model's plan for a system and
// its plan as Onshape has it now. Pure, so it's tested without Onshape; cad.ts adds the shape
// check for parts whose file changed (another part of the same Part Studio may be what moved).

type Plan = { jobs: { key: string; path: string; state?: string }[]; placements: { j: number; k: string }[]; names: Record<string, string> };

// `before` / `after`: the Part Studio file holding the part (its preview, no Onshape calls).
export type CadChange = {
  key: string;
  name: string;
  change: "added" | "removed" | "modified";
  geometry: boolean;
  count?: { from: number; to: number };
  note?: string;
  before?: { file: string; k: string };
  after?: { file: string; k: string };
};

// A part whose file changed: compare shapes to tell.
export type ShapeCandidate = { k: string; before: Plan["jobs"][number]; after: Plan["jobs"][number] };

const partIdOf = (k: string) => k.slice(k.lastIndexOf(":") + 1);

function byPart(plan: Plan | null) {
  const out = new Map<string, { count: number; job: Plan["jobs"][number] }>();
  for (const p of plan?.placements ?? []) {
    const had = out.get(p.k);
    if (had) had.count++;
    else out.set(p.k, { count: 1, job: plan!.jobs[p.j] });
  }
  return out;
}

export function comparePlans(old: Plan | null, now: Plan): { changes: CadChange[]; candidates: ShapeCandidate[] } {
  const before = byPart(old);
  const after = byPart(now);
  const name = (k: string) => now.names[k] ?? old?.names[k] ?? partIdOf(k);
  const changes: CadChange[] = [];
  const candidates: ShapeCandidate[] = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b) {
      changes.push({ key: k, name: name(k), change: "added", geometry: false, after: { file: a.job.key, k } });
      continue;
    }
    if (b.job.key !== a.job.key) candidates.push({ k, before: b.job, after: a.job });
    else if (b.count !== a.count) changes.push(modified(k, name(k), b, a, false));
  }
  for (const [k, b] of before) if (!after.has(k)) changes.push({ key: k, name: name(k), change: "removed", geometry: false, before: { file: b.job.key, k } });
  return { changes, candidates };
}

function modified(k: string, name: string, b: { count: number; job: { key: string } }, a: { count: number; job: { key: string } }, geometry: boolean, note?: string): CadChange {
  return {
    key: k,
    name,
    change: "modified",
    geometry,
    ...(b.count !== a.count ? { count: { from: b.count, to: a.count } } : {}),
    ...(note ? { note } : {}),
    before: { file: b.job.key, k },
    after: { file: a.job.key, k },
  };
}

// The candidates after the shape check: `sigs` maps "before"/"after" + part key to a fingerprint
// (missing when it couldn't be read). Same shape and count: no change.
export function settleCandidates(old: Plan | null, now: Plan, candidates: ShapeCandidate[], sigs: { before: Record<string, string>; after: Record<string, string> }): CadChange[] {
  const before = byPart(old);
  const after = byPart(now);
  const name = (k: string) => now.names[k] ?? old?.names[k] ?? partIdOf(k);
  const out: CadChange[] = [];
  for (const c of candidates) {
    const b = before.get(c.k)!;
    const a = after.get(c.k)!;
    const s0 = sigs.before[c.k];
    const s1 = sigs.after[c.k];
    if (s0 && s1 && s0 === s1) {
      if (b.count !== a.count) out.push(modified(c.k, name(c.k), b, a, false));
      continue;
    }
    out.push(modified(c.k, name(c.k), b, a, true, s0 && s1 ? undefined : "Shape not compared before"));
  }
  return out;
}

export const sortChanges = (list: CadChange[]) => {
  const order = { modified: 0, added: 1, removed: 2 };
  return [...list].sort((x, y) => order[x.change] - order[y.change] || x.name.localeCompare(y.name, undefined, { numeric: true }));
};
