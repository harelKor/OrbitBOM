// Runs the Design check on the loaded 3D model, in the page (where the meshes are), pausing now
// and then so the page keeps drawing. Phase 1 (Harel, 2026-11-13): weight, frame perimeter and
// height, interference. The maths lives in src/lib/check/ (tested without a browser).
import * as THREE from "three";
import type { CheckPart } from "@/components/viewer/checkScene";
import type { ViewerModel } from "@/components/viewer/types";
import { accessChecks } from "@/lib/check/access";
import { findClashes } from "@/lib/check/clash";
import { plateChecks } from "@/lib/check/plates";
import { printedChecks } from "@/lib/check/printed";
import { contacts, floating, holeOffsets, merge, screwChecks, worldBoxes } from "@/lib/check/connections";
import { buildEnvelope, hull, type PlanPart } from "@/lib/check/envelope";
import type { CheckLimits, CheckResults } from "@/lib/check/types";
import { meshVolume, weigh, type PartFacts, type WeighInput } from "@/lib/check/weight";

export type RunContext = {
  model: ViewerModel;
  names: Map<string, string>;
  systemsOf: Map<string, string[]>; // a BOM key's systems (one Onshape part can sit in two)
  facts: Record<string, PartFacts>;
  limits: CheckLimits;
  ignored: Set<string>;
};

export type Progress = (step: string, done: number, total: number) => void;

// A pause that lets the page draw and take taps. Through a MessageChannel, not setTimeout:
// browsers hold a hidden tab's timers to one a second, which made a run take minutes when the
// member switched tabs.
function pauser() {
  let last = performance.now();
  const channel = new MessageChannel();
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  return async () => {
    if (performance.now() - last < 25) return;
    await new Promise<void>((r) => {
      waiting.push(r);
      channel.port2.postMessage(0);
    });
    last = performance.now();
  };
}

// Which system a placed copy belongs to: its subsystem group's, matched to the part's own
// systems when the group holds several.
export function systemOf(ctx: RunContext, key: string, g: number): string | null {
  const group = ctx.model.groups?.[g]?.systemIds ?? [];
  const own = ctx.systemsOf.get(key) ?? [];
  return own.find((s) => group.includes(s)) ?? (group.length === 1 ? group[0] : (own[0] ?? group[0] ?? null));
}

// A short signature of the model: the same placements and files give the same one, so the page
// can tell when saved results are from an older model.
export function modelSig(model: ViewerModel): string {
  const text = JSON.stringify([model.keys ?? model.studios, model.placements.map((p) => [p.k, p.g ?? 0, p.t.map((x) => Math.round(x * 1e5))])]);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${model.placements.length}-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

const AXES = { z: [0, 1, 2], y: [2, 0, 1], x: [1, 2, 0] } as const; // [plan u, plan v, up]

export async function runCheck(parts: CheckPart[], ctx: RunContext, progress: Progress): Promise<CheckResults> {
  const started = performance.now();
  const pause = pauser();
  const excluded = new Set(ctx.limits.exclude ?? []);
  const placed = parts.map((p) => ({ ...p, systemId: systemOf(ctx, p.key, p.g) }));
  const counted = placed.filter((p) => !p.systemId || !excluded.has(p.systemId));

  // Weight: each mesh's volume once, times its copies.
  progress("Weighing parts", 0, 1);
  const volume = new Map<THREE.BufferGeometry, number>();
  const rows = new Map<string, WeighInput>();
  for (const p of counted) {
    let v = volume.get(p.geometry);
    if (v === undefined) {
      v = meshVolume(p.geometry.attributes.position.array, p.geometry.index!.array) * 1e6;
      volume.set(p.geometry, v);
      await pause();
    }
    const id = `${p.key}|${p.systemId ?? ""}`;
    const row = rows.get(id) ?? { key: p.key, name: ctx.names.get(p.key) ?? "Unnamed part", systemId: p.systemId, count: 0, volumeCm3: v };
    row.count++;
    rows.set(id, row);
  }
  const facts = new Map(Object.entries(ctx.facts));
  const weight = weigh([...rows.values()], facts);

  // Frame perimeter and height, in the plan view of the model's up axis.
  const [u, w, up] = AXES[ctx.limits.up ?? "z"];
  const e = (m: THREE.Matrix4) => m.elements; // column-major: row r, column c at c * 4 + r
  const at = (el: number[] | Float32Array, row: number, x: number, y: number, z: number) => (el[row] * x + el[4 + row] * y + el[8 + row] * z + el[12 + row]) * 1000;
  let floor = Infinity;
  let top = -Infinity;
  for (let i = 0; i < counted.length; i++) {
    const pos = counted[i].geometry.attributes.position.array;
    const el = e(counted[i].matrix);
    for (let k = 0; k < pos.length; k += 3) {
      const h = at(el, up, pos[k], pos[k + 1], pos[k + 2]);
      if (h < floor) floor = h;
      if (h > top) top = h;
    }
    progress("Measuring the frame", i, counted.length * 2);
    await pause();
  }
  const zone = ctx.limits.frameZoneMm ?? null;
  const plan: PlanPart[] = [];
  for (let i = 0; i < counted.length; i++) {
    const p = counted[i];
    const pos = p.geometry.attributes.position.array;
    const el = e(p.matrix);
    const all: number[] = [];
    const low: number[] = [];
    for (let k = 0; k < pos.length; k += 3) {
      const x = at(el, u, pos[k], pos[k + 1], pos[k + 2]);
      const y = at(el, w, pos[k], pos[k + 1], pos[k + 2]);
      all.push(x, y);
      if (zone == null || at(el, up, pos[k], pos[k + 1], pos[k + 2]) - floor <= zone) low.push(x, y);
    }
    plan.push({ key: p.key, name: ctx.names.get(p.key) ?? "Unnamed part", outline: hull(all), frame: low.length >= 6 ? hull(low) : low });
    progress("Measuring the frame", counted.length + i, counted.length * 2);
    await pause();
  }
  const envelope = counted.length ? buildEnvelope(plan, top - floor) : null;

  // Interference, on every part (the bumpers too).
  const clashes = await findClashes(
    placed.map((p) => ({ key: p.key, name: ctx.names.get(p.key) ?? "Unnamed part", geometry: p.geometry, matrix: p.matrix, flat: p.flat })),
    { ignored: ctx.ignored, pause, progress: (done, total) => progress("Looking for overlaps", done, total) },
  );

  // Connections (phase 2): round faces come from each mesh's topology, worked out in the
  // viewer's workers just after the meshes arrive.
  progress("Reading holes and screws", 0, 1);
  for (let t = 0; t < 150 && placed.some((p) => !p.geometry.userData.topology); t++) await new Promise((r) => setTimeout(r, 200));
  const list = placed.map((p) => ({ key: p.key, name: ctx.names.get(p.key) ?? "Unnamed part", geometry: p.geometry, matrix: p.matrix }));
  const boxes = worldBoxes(list);
  const touching = await contacts(list, boxes, { pause, progress: (done, total) => progress("Finding what touches what", done, total) });
  const screws = screwChecks(list, boxes);
  progress("Checking screws can be reached", 0, 1);
  await pause();
  const access = accessChecks(list, boxes, screws.screws);
  progress("Looking at plates and printed parts", 0, 1);
  await pause();
  const plates = plateChecks(list, ctx.facts);
  await pause();
  const printed = printedChecks(list, ctx.facts);
  const findings = merge([...floating(list, boxes, touching), ...holeOffsets(list, touching), ...screws.findings, ...access, ...plates, ...printed]);

  return { v: 1, weight, envelope, clashes, findings, ms: Math.round(performance.now() - started) };
}
