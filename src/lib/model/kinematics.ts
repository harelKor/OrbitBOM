// Motion along the mates in the browser (plan/cad-mates.md): the model's rigid bodies and joints
// (mates.ts) as a tree from each piece's base: its body placed first in the assembly (bodies are
// numbered in placement order), as Onshape fixes the first part inserted.
// Each joint has a value per degree of freedom, 0 at the CAD place; a body's move is its joints'
// moves from the base, so an arm on an elevator carriage rides up with it and still turns about
// its own axis. A joint inside a closed loop (a four-bar, a belt drawn with mates) is locked:
// solving loops is Onshape's job. Relations move a second joint with the first; limits clamp.
import * as THREE from "three";
import { slides, turns, type Joint, type Relation } from "./mates";

export type Dof = "turn" | "slide";
export type JointValue = { turn: number; slide: number };

export type Kinematics = {
  movable: (j: number) => boolean;
  driver: (body: number) => number | null; // the nearest movable joint between a body and its base
  frame: (j: number) => THREE.Matrix4; // the joint's connector frame on its moving side, where it is now (model frame)
  dir: (j: number) => 1 | -1; // +1 when a positive value moves the far side the joint's way
  value: (j: number) => JointValue;
  set: (j: number, dof: Dof, v: number) => Set<number>; // the bodies that moved
  moves: () => Map<number, THREE.Matrix4>; // each body's move from its CAD place (bodies that moved)
  values: () => Record<string, [number, number]>; // by joint id, only the moved ones
  restore: (v: Record<string, [number, number]>) => Set<number>;
  reset: () => void;
  moved: () => boolean;
};

const m4 = (f: number[]) => new THREE.Matrix4().set(...(f as Parameters<THREE.Matrix4["set"]>));

// The joint's own motion in its connector frame.
function local(type: Joint["type"], q: JointValue, out: THREE.Matrix4) {
  const r = new THREE.Matrix4().makeRotationZ(turns(type) ? q.turn : 0);
  const s = slides(type) ? q.slide : 0;
  const t = type === "pinSlot" ? new THREE.Matrix4().makeTranslation(s, 0, 0) : new THREE.Matrix4().makeTranslation(0, 0, s);
  return type === "pinSlot" ? out.multiplyMatrices(r, t) : out.multiplyMatrices(t, r);
}

export function createKinematics(joints: Joint[], relations: Relation[]): Kinematics {
  const frames = joints.map((j) => m4(j.f));
  const inverses = frames.map((f) => f.clone().invert());
  const q: JointValue[] = joints.map(() => ({ turn: 0, slide: 0 }));
  const adj = new Map<number, { j: number; to: number }[]>();
  const link = (x: number, j: number, to: number) => adj.set(x, [...(adj.get(x) ?? []), { j, to }]);
  joints.forEach((jt, j) => {
    link(jt.a, j, jt.b);
    link(jt.b, j, jt.a);
  });

  // Bridges (Tarjan): a joint not on any cycle can move; one on a cycle can't.
  const bridge = new Set<number>();
  {
    const disc = new Map<number, number>();
    const low = new Map<number, number>();
    let time = 0;
    const visit = (u: number, viaJoint: number) => {
      disc.set(u, time);
      low.set(u, time++);
      for (const { j, to } of adj.get(u) ?? []) {
        if (j === viaJoint) continue;
        if (!disc.has(to)) {
          visit(to, j);
          low.set(u, Math.min(low.get(u)!, low.get(to)!));
          if (low.get(to)! > disc.get(u)!) bridge.add(j);
        } else low.set(u, Math.min(low.get(u)!, disc.get(to)!));
      }
    };
    for (const u of adj.keys()) if (!disc.has(u)) visit(u, -1);
  }

  // The tree: each piece from its first body, breadth first.
  const parent = new Map<number, { j: number; from: number }>();
  const order: number[] = [];
  const seen = new Set<number>();
  const bodies = [...adj.keys()].sort((x, y) => x - y);
  for (const base of bodies) {
    if (seen.has(base)) continue;
    seen.add(base);
    const queue = [base];
    while (queue.length) {
      const u = queue.shift()!;
      order.push(u);
      for (const { j, to } of adj.get(u) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        parent.set(to, { j, from: u });
        queue.push(to);
      }
    }
  }
  const treeJoint = new Map([...parent].map(([child, p]) => [p.j, { child, from: p.from }]));
  const movable = (j: number) => bridge.has(j) && treeJoint.has(j);

  let D = new Map<number, THREE.Matrix4>();
  const compute = () => {
    const next = new Map<number, THREE.Matrix4>();
    const w = new THREE.Matrix4();
    for (const u of order) {
      const p = parent.get(u);
      if (!p) continue;
      const above = next.get(p.from);
      const isZero = !q[p.j].turn && !q[p.j].slide;
      if (isZero && !above) continue;
      // W = F · L(q) · F⁻¹ moves the second connector's side; the first side moves by its inverse.
      local(joints[p.j].type, q[p.j], w);
      w.premultiply(frames[p.j]).multiply(inverses[p.j]);
      if (joints[p.j].a === u) w.invert();
      next.set(u, above ? above.clone().multiply(w) : w.clone());
    }
    D = next;
  };

  const clamp = (j: number, dof: Dof, v: number) => {
    const lim = joints[j].lim?.[dof];
    return lim ? Math.min(lim[1], Math.max(lim[0], v)) : v;
  };
  const has = (j: number, dof: Dof) => (dof === "turn" ? turns(joints[j].type) : slides(joints[j].type));

  const set = (j: number, dof: Dof, v: number) => {
    const before = new Map(D);
    // The joint, then every joint tied to it by relations (each once).
    const done = new Set<string>();
    const go = (jj: number, d: Dof, value: number) => {
      const key = `${jj}:${d}`;
      if (done.has(key) || !movable(jj) || !has(jj, d)) return;
      done.add(key);
      const old = q[jj][d];
      q[jj][d] = clamp(jj, d, value);
      const delta = q[jj][d] - old;
      if (!delta) return;
      for (const r of relations) {
        if (r.from === jj && r.by === d) go(r.to, r.dof, q[r.to][r.dof] + r.k * delta);
        else if (r.to === jj && r.dof === d && r.k) go(r.from, r.by, q[r.from][r.by] + delta / r.k);
      }
    };
    go(j, dof, v);
    compute();
    const changed = new Set<number>();
    for (const b of new Set([...before.keys(), ...D.keys()])) if (!before.get(b)?.equals(D.get(b) ?? IDENTITY) || !D.has(b)) changed.add(b);
    return changed;
  };

  // On the moving side, as Onshape's handle rides with the part (the axis is the same line).
  const frame = (j: number) => {
    const t = treeJoint.get(j);
    const moved = t ? D.get(t.child) : undefined;
    return moved ? moved.clone().multiply(frames[j]) : frames[j].clone();
  };
  const dir = (j: number): 1 | -1 => (treeJoint.get(j)?.child === joints[j].a ? -1 : 1);
  const driver = (body: number) => {
    for (let u: number | undefined = body; u !== undefined; ) {
      const p = parent.get(u);
      if (!p) return null;
      if (movable(p.j)) return p.j;
      u = p.from;
    }
    return null;
  };

  return {
    movable,
    driver,
    frame,
    dir,
    value: (j) => ({ ...q[j] }),
    set,
    moves: () => D,
    values: () => {
      const out: Record<string, [number, number]> = {};
      q.forEach((v, j) => (v.turn || v.slide) && (out[joints[j].id] = [v.turn, v.slide]));
      return out;
    },
    restore: (v) => {
      const before = new Set(D.keys());
      joints.forEach((jt, j) => {
        const x = v[jt.id];
        q[j] = movable(j) && x ? { turn: turns(jt.type) ? clamp(j, "turn", x[0]) : 0, slide: slides(jt.type) ? clamp(j, "slide", x[1]) : 0 } : { turn: 0, slide: 0 };
      });
      compute();
      return new Set([...before, ...D.keys()]);
    },
    reset: () => {
      q.forEach((v) => ((v.turn = 0), (v.slide = 0)));
      D = new Map();
    },
    moved: () => D.size > 0,
  };
}

const IDENTITY = new THREE.Matrix4();
