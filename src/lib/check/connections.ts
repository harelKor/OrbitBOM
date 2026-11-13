import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import { expectedOverlap } from "./clash";
import { along, axisOffset, cylinders, lengthOf, worldCyl, type Cyl } from "./features";
import { findingId, type DesignFinding } from "./types";

// Phase 2 of the Design check (Harel's list, 2026-11-13): connections. Parts not attached to the
// rest of the robot, holes in parts that touch that don't line up, and each screw against the
// holes it goes through (tapped, clearance or loose; how much thread; long enough for its nut;
// sticking out), and parts held to each other by a single screw. All from the meshes' round faces
// (features.ts); model space, metres.

export type Inst = { key: string; name: string; geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 };
type Opts = { pause?: () => Promise<void>; progress?: (done: number, total: number) => void };

export const GAP = 1e-3; // closer than this counts as touching (round faces are only 0.5 mm exact)

const NUT = /\bnuts?\b|nyloc|keps/i;
const WASHER = /\bwashers?\b/i;
const RIVET = /\brivets?\b/i;
const INSERT = /\binserts?\b|helicoil/i;
// Parts that sit round a screw by design and turn about it or don't care: not "held by one screw".
const ROUND = /standoff|spacer|bushing|washer|collar|bearing|pulley|gear|sprocket|wheel|hub|shaft|insert|nut|roller|bumper/i;

export const isScrew = (name: string) => expectedOverlap(name) === "screw or insert" && !NUT.test(name) && !WASHER.test(name) && !INSERT.test(name) && !RIVET.test(name);
export const isConnector = (name: string) => isScrew(name) || RIVET.test(name);

const mm = (m: number) => (m * 1000).toFixed(1);
const dia = (r: number) => `Ø${(r * 2000).toFixed(1)}`;
const pt = (v: THREE.Vector3): [number, number, number] => [v.x * 1000, v.y * 1000, v.z * 1000];

export function worldBoxes(list: Inst[]): THREE.Box3[] {
  return list.map((it) => {
    if (!it.geometry.boundingBox) it.geometry.computeBoundingBox();
    return it.geometry.boundingBox!.clone().applyMatrix4(it.matrix);
  });
}

// Which placed copies touch (or overlap): pairs closer than GAP, from their BVHs.
export async function contacts(list: Inst[], boxes: THREE.Box3[], opts: Opts = {}): Promise<[number, number][]> {
  const order = boxes.map((b, i) => ({ i, b: b.clone().expandByScalar(GAP / 2) })).sort((p, q) => p.b.min.x - q.b.min.x);
  const pairs: [number, number][] = [];
  for (let s = 0; s < order.length; s++) {
    for (let t = s + 1; t < order.length && order[t].b.min.x <= order[s].b.max.x; t++) {
      if (order[s].b.intersectsBox(order[t].b)) pairs.push([order[s].i, order[t].i]);
    }
  }
  const out: [number, number][] = [];
  const toLocal = new THREE.Matrix4();
  for (let p = 0; p < pairs.length; p++) {
    const [i, j] = pairs[p];
    const bvh = list[i].geometry.boundsTree as MeshBVH | undefined;
    if (bvh) {
      toLocal.copy(list[i].matrix).invert().multiply(list[j].matrix);
      if (bvh.closestPointToGeometry(list[j].geometry, toLocal, undefined, undefined, GAP, GAP)) out.push([i, j]);
    }
    opts.progress?.(p + 1, pairs.length);
    await opts.pause?.();
  }
  return out;
}

// Groups of parts that touch each other; every group but the biggest is "not attached".
export function floating(list: Inst[], boxes: THREE.Box3[], touching: [number, number][]): DesignFinding[] {
  const parent = list.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const [i, j] of touching) parent[root(i)] = root(j);
  const groups = new Map<number, number[]>();
  list.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
  const size = (g: number[]) => g.reduce((s, i) => s + boxes[i].getSize(new THREE.Vector3()).length(), 0);
  const all = [...groups.values()].sort((a, b) => size(b) - size(a));
  // Copies of one group (both elevator uprights) are one finding in two places.
  return merge(all.slice(1).map((g) => {
    const keys = [...new Set(g.map((i) => list[i].key))];
    const names = [...new Set(g.map((i) => list[i].name))];
    const at = boxes[g[0]].getCenter(new THREE.Vector3());
    const who = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
    return {
      id: findingId("floating", keys),
      kind: "floating",
      keys,
      names,
      text: `${who} ${names.length > 1 ? "don't" : "doesn't"} touch the rest of the robot (nothing within 1 mm): not attached, or a gap in the CAD.`,
      at: pt(at),
      level: "warn",
      copies: 1,
    } satisfies DesignFinding;
  }));
}

// Holes in two touching parts that should be one hole but are slightly apart.
export function holeOffsets(list: Inst[], touching: [number, number][]): DesignFinding[] {
  const out: DesignFinding[] = [];
  const holes = (i: number) => cylinders(list[i].geometry).filter((c) => c.hole && c.r < 0.02).map((c) => worldCyl(c, list[i].matrix));
  const cache = new Map<number, Cyl[]>();
  const of = (i: number) => cache.get(i) ?? (cache.set(i, holes(i)), cache.get(i)!);
  for (const [i, j] of touching) {
    if (isConnector(list[i].name) || isConnector(list[j].name)) continue;
    const A = of(i);
    const B = of(j);
    if (!A.length || !B.length) continue;
    for (const h of A) {
      for (const k of B) {
        const ratio = h.r / k.r;
        if (ratio < 0.6 || ratio > 1.67) continue;
        const off = axisOffset(h, k);
        if (!(off > 1.5e-4 && off < 0.8 * Math.min(h.r, k.r))) continue;
        // End to end along the axis (stacked parts), not just parallel somewhere.
        const [lo, hi] = along(h, k);
        const len = lengthOf(h);
        if (lo > len + GAP || hi < -GAP) continue;
        const [x, y] = list[i].key < list[j].key ? [list[i], list[j]] : [list[j], list[i]];
        const at = h.a.clone().add(h.b).multiplyScalar(0.5);
        out.push({
          id: findingId("hole-offset", [x.key, y.key], `${Math.round(h.r * 2e4)}`),
          kind: "hole-offset",
          keys: [x.key, y.key],
          names: [x.name, y.name],
          text: `The ${dia(h.r)} hole in ${list[i].name} and the ${dia(k.r)} hole in ${list[j].name} are ${mm(off)} mm off each other: a screw won't go through both.`,
          at: pt(at),
          level: "warn",
          copies: 1,
        });
      }
    }
  }
  return merge(out);
}

// A screw's shaft, head and which way it goes in, from its round faces.
export type Screw = { i: number; d: number; head: Cyl | null; shaft: Cyl; from: THREE.Vector3; dir: THREE.Vector3; len: number };

export function screwOf(list: Inst[], i: number): Screw | null {
  const outer = cylinders(list[i].geometry).filter((c) => !c.hole).map((c) => worldCyl(c, list[i].matrix));
  if (!outer.length) return null;
  const shaft = outer.reduce((a, b) => (lengthOf(b) > lengthOf(a) ? b : a));
  const heads = outer.filter((c) => c !== shaft && c.r > shaft.r * 1.2 && axisOffset(shaft, c) < 2e-4);
  const head = heads.length ? heads.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  let from = shaft.a.clone();
  let to = shaft.b.clone();
  if (head) {
    const hm = head.a.clone().add(head.b).multiplyScalar(0.5);
    if (hm.distanceTo(to) < hm.distanceTo(from)) [from, to] = [to, from];
  }
  return { i, d: shaft.r * 2, head, shaft, from, dir: to.clone().sub(from).normalize(), len: from.distanceTo(to) };
}

// Every screw against the holes it goes through, and which parts each screw holds together.
export function screwChecks(list: Inst[], boxes: THREE.Box3[]): { findings: DesignFinding[]; screws: Screw[] } {
  const out: DesignFinding[] = [];
  const screws: Screw[] = [];
  const joints = new Map<string, { a: number; b: number; screws: number; at: THREE.Vector3 }>();
  const segBox = new THREE.Box3();
  for (let i = 0; i < list.length; i++) {
    if (!isConnector(list[i].name)) continue;
    const s = screwOf(list, i);
    if (!s) continue;
    const rivet = RIVET.test(list[i].name);
    if (!rivet) screws.push(s);
    const tip = s.from.clone().addScaledVector(s.dir, s.len);
    segBox.makeEmpty().expandByPoint(s.from).expandByPoint(tip).expandByScalar(s.d / 2 + GAP);
    // The holes on its axis, in the parts round it: where along the screw (from under the head).
    const on: { j: number; lo: number; hi: number; r: number; nut: boolean }[] = [];
    for (let j = 0; j < list.length; j++) {
      if (j === i || !boxes[j].intersectsBox(segBox)) continue;
      if (isConnector(list[j].name) || WASHER.test(list[j].name)) continue;
      for (const c of cylinders(list[j].geometry)) {
        if (!c.hole) continue;
        const h = worldCyl(c, list[j].matrix);
        if (axisOffset(s.shaft, h) > Math.max(3e-4, s.d * 0.06)) continue;
        const u = h.a.clone().sub(s.from).dot(s.dir);
        const w = h.b.clone().sub(s.from).dot(s.dir);
        const lo = Math.min(u, w);
        const hi = Math.max(u, w);
        if (hi < -GAP || lo > s.len + GAP) continue;
        on.push({ j, lo, hi, r: h.r, nut: NUT.test(list[j].name) });
      }
    }
    if (!on.length) continue;
    const name = list[i].name;
    const at = (x: number) => pt(s.from.clone().addScaledVector(s.dir, x));
    const add = (code: string, j: number, text: string, where: number, level: "warn" | "info" = "warn") => {
      const keys = [list[i].key, list[j].key];
      out.push({ id: findingId(code, keys), kind: code === "hole-size" ? "hole-size" : "screw-length", keys, names: [name, list[j].name], text, at: at(where), level, copies: 1 });
    };
    if (!rivet) {
      for (const h of on) {
        if (h.nut) continue;
        const q = (h.r * 2) / s.d;
        if (q < 0.72) add("hole-size", h.j, `The ${dia(h.r)} hole in ${list[h.j].name} is smaller than the ${dia(s.d / 2)} screw (${name}).`, (h.lo + h.hi) / 2);
        else if (q > 1.2 && q < 2 && (!s.head || s.head.r > h.r) && h.lo < s.len - GAP)
          add("hole-size", h.j, `The ${dia(h.r)} hole in ${list[h.j].name} is loose for the ${dia(s.d / 2)} screw (${name}): a clearance hole is about ${dia((s.d * 1.06) / 2)}–${dia((s.d * 1.13) / 2)}.`, (h.lo + h.hi) / 2, "info");
      }
      // The far end: a nut, a tapped hole, or nothing.
      const nut = on.filter((h) => h.nut).sort((a, b) => b.hi - a.hi)[0];
      const tapped = on.filter((h) => !h.nut && (h.r * 2) / s.d >= 0.72 && (h.r * 2) / s.d < 0.97);
      const end = Math.max(...on.map((h) => h.hi));
      if (nut) {
        if (s.len < nut.hi - 3e-4) add("screw-short", nut.j, `${name} is ${mm(nut.hi - s.len)} mm too short to go through its nut.`, s.len);
      } else if (tapped.length) {
        const t = tapped.sort((a, b) => b.hi - a.hi)[0];
        const grip = Math.min(t.hi, s.len) - Math.max(t.lo, 0);
        if (grip < 0.8 * s.d) add("screw-thread", t.j, `${name} has only ${mm(Math.max(0, grip))} mm of thread in ${list[t.j].name}: aim for at least ${mm(s.d)} mm (its diameter).`, s.len, "info");
      }
      if (s.len - end > Math.max(0.015, 3 * s.d)) {
        const last = on.find((h) => h.hi === end)!;
        add("screw-long", last.j, `${name} sticks out ${mm(s.len - end)} mm past ${list[last.j].name}.`, s.len, "info");
      }
    }
    // The parts it holds together (not round ones that sit on a screw by design).
    const held = [...new Set(on.filter((h) => !h.nut && h.lo < s.len && h.hi > 0 && !ROUND.test(list[h.j].name)).map((h) => h.j))];
    for (let x = 0; x < held.length; x++) {
      for (let y = x + 1; y < held.length; y++) {
        const [a, b] = held[x] < held[y] ? [held[x], held[y]] : [held[y], held[x]];
        const k = `${a}|${b}`;
        const was = joints.get(k);
        if (was) was.screws++;
        else joints.set(k, { a, b, screws: 1, at: s.from.clone() });
      }
    }
  }
  for (const jn of joints.values()) {
    if (jn.screws !== 1) continue;
    const A = list[jn.a];
    const B = list[jn.b];
    if (A.key === B.key) continue;
    const keys = [A.key, B.key].sort();
    out.push({
      id: findingId("one-screw", keys),
      kind: "one-screw",
      keys,
      names: [A.name, B.name],
      text: `${A.name} is held to ${B.name} by one screw: it can turn about it unless something else stops it.`,
      at: pt(jn.at),
      level: "info",
      copies: 1,
    });
  }
  return { findings: merge(out), screws };
}

// One finding per id, counting the places it happens.
export function merge(list: DesignFinding[]): DesignFinding[] {
  const by = new Map<string, DesignFinding>();
  for (const f of list) {
    const was = by.get(f.id);
    if (was) was.copies++;
    else by.set(f.id, { ...f });
  }
  return [...by.values()];
}

