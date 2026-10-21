/* eslint-disable @typescript-eslint/no-explicit-any -- raw Onshape API responses */
/**
 * Drawing spike (plan/auto-drawings.md, step 0): read the exact geometry of real parts the way
 * the drawing engine will, and check that holes, taps, bearing fits and inner corner radii come
 * out exact. Read-only: it never writes to Onshape.
 *
 *   npm run drawing:spike -- "<Part Studio URL>" ["<Part Studio URL>" ...]
 *
 * Auth as in scripts/onshape-test.ts: ONSHAPE_ACCESS_KEY + ONSHAPE_SECRET_KEY, or ONSHAPE_TOKEN,
 * in .env.local. Prints a summary per part and saves the raw answers to scripts/out/drawing/
 * (git-ignored); those files become the drawing engine's test fixtures.
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { BEARINGS, HOLE_MATCH_MM, TAPS } from "../src/config/drawings";
import { apiPath, parseOnshapeUrl } from "../src/lib/onshape/url";

config({ path: ".env.local" });
config();

const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!urls.length) {
  console.error('Usage: npm run drawing:spike -- "<Part Studio URL>" ["<Part Studio URL>" ...]');
  process.exit(1);
}

const { ONSHAPE_ACCESS_KEY, ONSHAPE_SECRET_KEY, ONSHAPE_TOKEN } = process.env;
const authHeader = ONSHAPE_TOKEN
  ? `Bearer ${ONSHAPE_TOKEN}`
  : ONSHAPE_ACCESS_KEY && ONSHAPE_SECRET_KEY
    ? `Basic ${Buffer.from(`${ONSHAPE_ACCESS_KEY}:${ONSHAPE_SECRET_KEY}`).toString("base64")}`
    : null;
if (!authHeader) {
  console.error("Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY (or ONSHAPE_TOKEN) in .env.local.");
  process.exit(1);
}

let calls = 0;
async function json(baseUrl: string, path: string): Promise<any> {
  let url = `${baseUrl}/api/v10/${path}`;
  for (let hop = 0; hop < 5; hop++) {
    const sameHost = new URL(url).hostname.endsWith("onshape.com");
    const res = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "application/json", ...(sameHost ? { Authorization: authHeader! } : {}) },
    });
    if (sameHost) calls++;
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error("Too many redirects");
}

const mm = (m: unknown) => Math.round(Number(m) * 1e5) / 100; // metres → mm, 2 decimals
const near = (a: number, b: number) => Math.abs(a - b) <= HOLE_MATCH_MM;

// What the engine needs from one body, read defensively: the answer's exact shape is what
// this spike is checking.
function summarize(body: any) {
  const faces: any[] = body.faces ?? [];
  const edges: any[] = body.edges ?? [];
  const faceTypes: Record<string, number> = {};
  const cylinders: { d: number; full: boolean }[] = [];
  for (const f of faces) {
    const s = f.surface ?? {};
    const type = String(s.type ?? "unknown").toLowerCase();
    faceTypes[type] = (faceTypes[type] ?? 0) + 1;
    if (type === "cylinder" && s.radius != null) {
      // A hole's wall is one full cylinder; an inner corner is a part of one. Onshape may split a
      // full hole into two half faces, so "full" is a guess from the face's loops.
      const loops: any[] = f.loops ?? [];
      cylinders.push({ d: mm(2 * s.radius), full: loops.length >= 2 });
    }
  }
  const circles = edges.filter((e) => String(e.curve?.type ?? "").toLowerCase() === "circle").map((e) => mm(2 * e.curve.radius));
  const byDiameter = new Map<number, number>();
  for (const c of cylinders) byDiameter.set(c.d, (byDiameter.get(c.d) ?? 0) + 1);
  const notes: string[] = [];
  for (const [d, n] of byDiameter) {
    const tap = TAPS.find((t) => near(d, t.drillMm));
    const bearing = BEARINGS.find((b) => near(d, b.boreMm));
    if (tap) notes.push(`${n} face(s) Ø${d} → ${tap.note}`);
    if (bearing) notes.push(`${n} face(s) Ø${d} → fit for ${bearing.name}`);
  }
  const partial = cylinders.filter((c) => !c.full).map((c) => c.d / 2);
  return {
    id: body.id,
    name: body.properties?.name ?? body.name,
    faceTypes,
    cylinderDiameters: [...byDiameter].sort((a, b) => a[0] - b[0]).map(([d, n]) => `Ø${d}×${n}`),
    circleEdges: circles.length,
    notes,
    smallestPartialRadius: partial.length ? Math.min(...partial) : null,
  };
}

async function main() {
  mkdirSync("scripts/out/drawing", { recursive: true });
  for (const input of urls) {
    const ref = parseOnshapeUrl(input);
    if (!ref?.eid) {
      console.error(`Not an Onshape element URL: ${input}`);
      continue;
    }
    const path = apiPath(ref);
    const tag = `${ref.did.slice(-6)}-${ref.eid.slice(-6)}`;
    console.log(`\nPart Studio ${input}`);
    try {
      const details = await json(ref.baseUrl, `partstudios/${path}/bodydetails`);
      writeFileSync(`scripts/out/drawing/${tag}.bodydetails.json`, JSON.stringify(details, null, 2));
      const edges = await json(ref.baseUrl, `partstudios/${path}/tessellatededges?angleTolerance=0.1&chordTolerance=0.00005`);
      writeFileSync(`scripts/out/drawing/${tag}.tessellatededges.json`, JSON.stringify(edges, null, 2));
      const bodies: any[] = details.bodies ?? (Array.isArray(details) ? details : []);
      console.log(`  top-level keys: ${Object.keys(details).join(", ")}; ${bodies.length} bodies; edges answer: ${Array.isArray(edges) ? `${edges.length} bodies` : Object.keys(edges).join(", ")}`);
      for (const b of bodies) console.log(JSON.stringify(summarize(b), null, 2).replace(/^/gm, "  "));
    } catch (err) {
      console.log(`  FAILED: ${(err as Error).message}`);
    }
  }
  console.log(`\n${calls} Onshape calls. Raw answers in scripts/out/drawing/.`);
}

main();
