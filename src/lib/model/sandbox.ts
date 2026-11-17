// A small synthetic robot for the local 3D sandbox (/dev/viewer, plan/cad-3d-viewer.md S0): local
// dev has no Onshape and no R2, so this builds a few part shapes in code (a plate with holes, two
// box tubes, two round standoffs, two see-through polycarb plates) and places them a few dozen
// times in three subsystems. Meshes follow Onshape's export rules (mesh.ts): metres, Z up, and
// vertices shared within one face only, so picking and measuring see real faces and edges. Kept
// small on purpose (Harel, 2026-11-10: the sandbox should cost little).
import type { Appearance, Mesh } from "./mesh";

type P2 = [number, number];
type V3 = [number, number, number];
type Tri2 = [P2, P2, P2];

// One mesh from faces given as triangles; each face gets its own vertices.
function meshOf(partId: string, faces: V3[][][], appearance?: Appearance): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const tris of faces) {
    const seen = new Map<string, number>();
    for (const tri of tris) {
      for (const p of tri) {
        const k = p.map((x) => Math.round(x * 1e7)).join(",");
        let i = seen.get(k);
        if (i === undefined) {
          i = pos.length / 3;
          seen.set(k, i);
          pos.push(...p);
        }
        idx.push(i);
      }
    }
  }
  return { partId, positions: new Float32Array(pos), indices: new Uint32Array(idx), ...(appearance && { appearance }) };
}

const key2 = (p: P2) => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;

// A flat profile (counter-clockwise triangles in XY) pushed up `h` along Z: top, bottom, and walls
// on its border, grouped into faces by `wall(midpoint, outward normal)`.
function prism(tris: Tri2[], h: number, wall: (mid: P2, out: P2) => string): V3[][][] {
  const top = tris.map((t) => t.map(([x, y]) => [x, y, h] as V3));
  const bottom = tris.map(([a, b, c]) => [c, b, a].map(([x, y]) => [x, y, 0] as V3));
  // Border sides: used by one triangle only; the inside is on their left.
  const uses = new Map<string, number>();
  const sides: [P2, P2][] = [];
  for (const t of tris) {
    for (let j = 0; j < 3; j++) {
      const a = t[j], b = t[(j + 1) % 3];
      sides.push([a, b]);
      const k = [key2(a), key2(b)].sort().join("|");
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const walls = new Map<string, V3[][]>();
  for (const [a, b] of sides) {
    if (uses.get([key2(a), key2(b)].sort().join("|")) !== 1) continue;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const out: P2 = [(b[1] - a[1]) / d, -(b[0] - a[0]) / d];
    const id = wall([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], out);
    const list = walls.get(id) ?? [];
    list.push(
      [[a[0], a[1], h], [a[0], a[1], 0], [b[0], b[1], 0]],
      [[a[0], a[1], h], [b[0], b[1], 0], [b[0], b[1], h]],
    );
    walls.set(id, list);
  }
  return [top, bottom, ...walls.values()];
}

// A flat side's face: by its outward direction (and which loop, for a profile with two).
const sideOf = (out: P2) => `${Math.round(out[0])},${Math.round(out[1])}`;

// A ring between two loops sampled at the same angles: `inner(θ)` and `outer(θ)`.
function ring(inner: (a: number) => P2, outer: (a: number) => P2, segs: number): Tri2[] {
  const out: Tri2[] = [];
  for (let j = 0; j < segs; j++) {
    const a0 = (j / segs) * Math.PI * 2, a1 = ((j + 1) / segs) * Math.PI * 2;
    const [i0, i1, o0, o1] = [inner(a0), inner(a1), outer(a0), outer(a1)];
    out.push([o0, o1, i1], [o0, i1, i0]);
  }
  return out;
}
const circle = (cx: number, cy: number, r: number) => (a: number): P2 => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
// A square's border at the circle's angles (corners at 45°: `segs` a multiple of 8).
const square = (cx: number, cy: number, half: number) => (a: number): P2 => {
  const c = Math.cos(a), s = Math.sin(a);
  const k = half / Math.max(Math.abs(c), Math.abs(s));
  return [cx + c * k, cy + s * k];
};

// A plate of nx × ny square cells, a round hole in each: 0..nx·cell by 0..ny·cell, `t` thick.
function holePlate(nx: number, ny: number, cell: number, r: number, t: number): V3[][][] {
  const tris: Tri2[] = [];
  const centers: P2[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      const c: P2 = [(x + 0.5) * cell, (y + 0.5) * cell];
      centers.push(c);
      tris.push(...ring(circle(c[0], c[1], r), square(c[0], c[1], cell / 2), 32));
    }
  return prism(tris, t, (mid, out) => {
    const hole = centers.findIndex((c) => Math.abs(Math.hypot(mid[0] - c[0], mid[1] - c[1]) - r) < r * 0.1);
    return hole >= 0 ? `hole${hole}` : sideOf(out);
  });
}

// A box tube, `w` × `h` outside with a `wall`-thick wall, `len` long along Z, centred on the axis.
function boxTube(w: number, h: number, wall: number, len: number): V3[][][] {
  const rect = (hw: number, hh: number): P2[] => [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const o = rect(w / 2, h / 2), i = rect(w / 2 - wall, h / 2 - wall);
  const tris: Tri2[] = [];
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    tris.push([o[k], o[n], i[n]], [o[k], i[n], i[k]]);
  }
  return prism(tris, len, (mid, out) => `${Math.abs(mid[0]) < w / 2 - wall / 2 && Math.abs(mid[1]) < h / 2 - wall / 2 ? "in" : "out"}${sideOf(out)}`);
}

// A round standoff (a tube): `rIn` hole, `rOut` outside, `len` long along Z.
function standoff(rIn: number, rOut: number, len: number): V3[][][] {
  return prism(ring(circle(0, 0, rIn), circle(0, 0, rOut), 24), len, (mid) => (Math.hypot(mid[0], mid[1]) < (rIn + rOut) / 2 ? "in" : "out"));
}

// A plain plate, 0..w by 0..h, `t` thick.
function sheet(w: number, h: number, t: number): V3[][][] {
  return prism([[[0, 0], [w, 0], [w, h]], [[0, 0], [w, h], [0, h]]], t, (_, out) => sideOf(out));
}

const ALUMINIUM: Appearance = { color: [0.78, 0.8, 0.83], opacity: 1 };
const BLUE: Appearance = { color: [0.16, 0.3, 0.72], opacity: 1 };
const BRASS: Appearance = { color: [0.83, 0.68, 0.3], opacity: 1 };
const POLYCARB: Appearance = { color: [0.75, 0.88, 1], opacity: 0.35 };

const PLATE = { w: 0.24, h: 0.09, t: 0.004 }; // 8 × 3 cells of 30 mm, 16 mm holes
const TUBE = { w: 0.0508, h: 0.0254 }; // 2" × 1" box tube
const FRAME = 0.7;
const SHORT = FRAME - 2 * TUBE.h; // the frame's side tubes fit between the front and back ones
const LONG_STANDOFF = 0.396;

// The sandbox's one Part Studio: every shape, by part id.
export function sandboxStudio(): Mesh[] {
  return [
    meshOf("PLATE", holePlate(8, 3, 0.03, 0.008, PLATE.t), ALUMINIUM),
    meshOf("TUBE_L", boxTube(TUBE.w, TUBE.h, 0.0016, FRAME), BLUE),
    meshOf("TUBE_S", boxTube(TUBE.w, TUBE.h, 0.0016, SHORT), BLUE),
    meshOf("STANDOFF", standoff(0.0025, 0.00635, 0.1), BRASS),
    meshOf("STANDOFF_L", standoff(0.0025, 0.00635, LONG_STANDOFF), BRASS),
    meshOf("PC_BELLY", sheet(0.6, 0.6, 0.003), POLYCARB),
    meshOf("PC_SHIELD", sheet(0.24, 0.4, 0.003), POLYCARB),
  ];
}

// A placement transform (row-major 4 × 4, like Onshape's): the part's own X and Z axes in the
// robot's frame, and where its origin goes.
function at(o: V3, x: V3 = [1, 0, 0], z: V3 = [0, 0, 1]): number[] {
  const y: V3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2], 0, 0, 0, 1];
}
const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0];
const ALONG_X = { x: Y, z: X }; // a tube or standoff along the robot's X
const ALONG_Y = { x: X, z: Y };
const STANDING_XZ = { x: X, z: Y }; // a plate standing up, facing Y (its height goes down from o)
const STANDING_YZ = { x: Y, z: X }; // a plate standing up, facing X

type Placed = { part: string; name: string; t: number[] };

const SYSTEMS: { id: string; name: string; parts: Placed[] }[] = [
  {
    id: "drive",
    name: "Drivetrain",
    parts: [
      ...[0, FRAME].map((y) => ({ part: "TUBE_L", name: "Frame rail", t: at([0, y, TUBE.h / 2], ALONG_X.x, ALONG_X.z) })),
      ...[0.05, FRAME - 0.05].map((x) => ({ part: "TUBE_S", name: "Frame side tube", t: at([x, TUBE.h, TUBE.h / 2], ALONG_Y.x, ALONG_Y.z) })),
      { part: "PC_BELLY", name: "Bellypan", t: at([0.05, 0.05, -0.003]) },
      ...[0.08, 0.38].flatMap((x) => [0, FRAME].map((y) => ({ part: "PLATE", name: "Frame gusset", t: at([x, y - PLATE.h / 2, TUBE.h]) }))),
      ...[0.12, FRAME - 0.12].flatMap((x) => [0.12, FRAME - 0.12].map((y) => ({ part: "STANDOFF", name: "Battery standoff", t: at([x, y, 0]) }))),
      // Deliberate clashes, to see the section's red interference (R1, plan/cad-3d-viewer.md): a
      // third gusset overlapping the first (two copies of one shape) and a standoff straight
      // through the front rail's walls (two different shapes).
      { part: "PLATE", name: "Clash gusset", t: at([0.2, -PLATE.h / 2, TUBE.h]) },
      { part: "STANDOFF", name: "Clash standoff", t: at([0.6, 0, -0.03]) },
    ],
  },
  {
    id: "intake",
    name: "Intake",
    parts: [
      ...[0.15, 0.55].map((y) => ({ part: "PLATE", name: "Intake side plate", t: at([FRAME, y, 0.2], STANDING_XZ.x, STANDING_XZ.z) })),
      ...[0.76, 0.82, 0.88].map((x) => ({ part: "STANDOFF_L", name: "Intake roller standoff", t: at([x, 0.15 + PLATE.t, 0.155], ALONG_Y.x, ALONG_Y.z) })),
      { part: "TUBE_S", name: "Intake crossbar", t: at([0.94, 0.08, 0.06], ALONG_Y.x, ALONG_Y.z) },
      { part: "PC_SHIELD", name: "Intake shield", t: at([FRAME, 0.15 + PLATE.t, 0.2]) },
    ],
  },
  {
    id: "elevator",
    name: "Elevator",
    parts: [
      ...[0.2, 0.5].map((y) => ({ part: "TUBE_L", name: "Elevator upright", t: at([0.3, y, TUBE.h]) })),
      ...[0.4, 0.55].map((z) => ({ part: "PLATE", name: "Carriage plate", t: at([0.3 + TUBE.h / 2, 0.23, z], STANDING_YZ.x, STANDING_YZ.z) })),
      ...[0.26, 0.44].flatMap((y) => [0.43, 0.58].map((z) => ({ part: "STANDOFF", name: "Carriage standoff", t: at([0.3 + TUBE.h / 2 + PLATE.t, y, z], ALONG_X.x, ALONG_X.z) }))),
    ],
  },
];

// The sandbox robot as the viewer reads it (one Part Studio file at `studioUrl`), with a name per
// part key. Every copy of a part in one subsystem shares its key, like a BOM part. `key` makes the
// file cacheable in the browser like a real one (its R2 key).
//
// `big` (/dev/viewer?big=1, the loading check in plan/cad-3d-viewer.md S2): the robot repeated on
// a grid, ~5000 instances of the same few shapes, spread over BIG_FILES copies of the file (same
// content, separate links and keys) so they load and draw one by one like a real robot's Part
// Studios. Each copy's parts get their own keys.
export const BIG_FILES = 8;
const BIG_GRID = 14; // 14 × 13 robots
export function sandboxRobot(studioUrl: string, opts: { key?: string; big?: boolean } = {}) {
  const names: Record<string, string> = {};
  const robots = opts.big ? BIG_GRID * (BIG_GRID - 1) : 1;
  const files = opts.big ? BIG_FILES : 1;
  const placements = Array.from({ length: robots }, (_, r) => {
    const dx = (r % BIG_GRID) * 1.4, dy = Math.floor(r / BIG_GRID) * 1.4;
    return SYSTEMS.flatMap((sys, g) =>
      sys.parts.map((p) => {
        const k = `sandbox:${opts.big ? `r${r}-` : ""}${sys.id}-${p.name.toLowerCase().replace(/\W+/g, "-")}:${p.part}`;
        names[k] = p.name;
        const t = [...p.t];
        t[3] += dx;
        t[7] += dy;
        return { s: r % files, k, t, g };
      }),
    );
  }).flat();
  const studios = opts.big ? Array.from({ length: files }, (_, i) => `${studioUrl}?n=${i}`) : [studioUrl];
  return {
    model: {
      studios,
      ...(opts.key && { keys: opts.big ? studios.map((_, i) => `${opts.key}/${i}`) : [opts.key] }),
      placements,
      groups: SYSTEMS.map((s) => ({ systemIds: [s.id], name: s.name })),
    },
    names,
  };
}

// A sheet metal U-bracket for the part window's Open flatten (/dev/viewer?flat=1): 150 mm long,
// a 50 mm base and two 25 mm flanges, 1.5 mm thick, 5 mm holes on 25 mm centres. "folded" is the
// part, "flat" its flat pattern lying on z = 0 like Onshape's (bend allowance ignored).
const SHEET = { len: 0.15, base: 0.05, flange: 0.025, t: 0.0015, cell: 0.025, r: 0.0025 };
export function sandboxSheetMetal(shape: "folded" | "flat"): Mesh {
  const { len, base, flange, t, cell, r } = SHEET;
  const nx = Math.round(len / cell);
  if (shape === "flat") return meshOf("SHEET_FLAT", holePlate(nx, Math.round((base + 2 * flange) / cell), cell, r, t), ALUMINIUM);
  const move = (faces: V3[][][], f: (p: V3) => V3) => faces.map((face) => face.map((tri) => tri.map(f)));
  // Flanges stand up from the base's long edges (proper rotations, so faces keep facing out).
  const front = move(holePlate(nx, 1, cell, r, t), ([x, y, z]) => [x, -z + t, y]);
  const back = move(holePlate(nx, 1, cell, r, t), ([x, y, z]) => [len - x, base - t + z, y]);
  return meshOf("SHEET", [...holePlate(nx, Math.round(base / cell), cell, r, t), ...front, ...back], ALUMINIUM);
}
