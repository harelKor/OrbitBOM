/* eslint-disable @typescript-eslint/no-explicit-any -- raw Onshape API responses */
/**
 * Sheet metal spike for Auto Layout (2026-11-04): can a sheet metal part's flat pattern stand in
 * for the folded part everywhere Auto Layout uses it? Checks, on one real part:
 *
 *   1. the parts list with includeFlatParts: the folded part and its flat body
 *   2. the insertables list with includeFlattenedBodies: the flat body's insertable entry
 *   3. tessellating the flat body (the shape the nesting would use) and its size
 *   4. its bounding box (flat size and thickness)
 *   5. a STEP of the flat body alone
 *   6. a DXF of the flat body alone
 *   7. with --write: a private scratch document in the API key owner's account, an assembly in
 *      it, the flat body inserted into it, the assembly read back and exported as STEP (the
 *      whole-sheet STEP path). Nothing is written to the part's own document.
 *
 *   npm run sheetmetal:spike -- "<Part Studio URL>" <folded part id> [--write]
 *
 * Auth as in scripts/onshape-test.ts: ONSHAPE_ACCESS_KEY + ONSHAPE_SECRET_KEY, or ONSHAPE_TOKEN,
 * in .env.local. Files land in scripts/out/sheet-metal/ (git-ignored). Prints the calls it made.
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseOnshapeUrl } from "../src/lib/onshape/url";

config({ path: ".env.local" });
config();

const args = process.argv.slice(2);
const write = args.includes("--write");
const [studioUrl, foldedId] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--scratch");
// --only7 skips the read checks (1 and 2 still run, they find the flat body).
const only7 = args.includes("--only7");
if (!studioUrl || !foldedId) {
  console.error('Usage: npm run sheetmetal:spike -- "<Part Studio URL>" <folded part id> [--write]');
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

const parsed = parseOnshapeUrl(studioUrl);
if (!parsed?.eid) {
  console.error("That isn't an Onshape Part Studio link.");
  process.exit(1);
}
const { baseUrl: base, did, wvm, wvmid, eid } = parsed;
const studio = `d/${did}/${wvm}/${wvmid}/e/${eid}`;
const OUT = "scripts/out/sheet-metal";
mkdirSync(OUT, { recursive: true });

let calls = 0;
async function call(path: string, init: { method?: string; body?: unknown } = {}, raw = false): Promise<any> {
  let url = path.startsWith("http") ? path : `${base}/api/v10/${path}`;
  for (let hop = 0; hop < 5; hop++) {
    const sameHost = new URL(url).hostname.endsWith("onshape.com");
    const res = await fetch(url, {
      method: hop === 0 ? (init.method ?? "GET") : "GET",
      redirect: "manual",
      headers: {
        Accept: raw ? "*/*" : "application/json",
        ...(init.body !== undefined && hop === 0 && { "Content-Type": "application/json" }),
        ...(sameHost ? { Authorization: authHeader! } : {}),
      },
      body: init.body !== undefined && hop === 0 ? JSON.stringify(init.body) : undefined,
    });
    if (sameHost) calls++;
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${init.method ?? "GET"} ${path}: ${(await res.text()).slice(0, 400)}`);
    return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  throw new Error("Too many redirects");
}

// Start a translation, poll it (slowly: every poll is a call) and download the file.
async function translate(path: string, params: Record<string, unknown>): Promise<Buffer> {
  let t = await call(path, { method: "POST", body: { ...params, storeInDocument: false } });
  for (let wait = 1500; t.requestState === "ACTIVE"; wait = Math.min(wait * 1.6, 8000)) {
    await new Promise((r) => setTimeout(r, wait));
    t = await call(`translations/${t.id}`);
  }
  if (t.requestState !== "DONE" || !t.resultExternalDataIds?.[0]) throw new Error(`translation ${t.requestState}: ${t.failureReason ?? "no reason given"}`);
  return call(`documents/d/${t.documentId}/externaldata/${t.resultExternalDataIds[0]}`, {}, true);
}

const mm = (m: number) => Math.round(m * 1e5) / 100;
const results: Record<string, string> = {};
async function step(name: string, run: () => Promise<string>) {
  const before = calls;
  try {
    results[name] = `OK   ${await run()}`;
  } catch (e) {
    results[name] = `FAIL ${(e as Error).message}`;
  }
  console.log(`${name}: ${results[name]} (${calls - before} calls)`);
}
const solids = (step: Buffer) => (step.toString("latin1").match(/MANIFOLD_SOLID_BREP/g) ?? []).length;
// The spread of a STEP file's points, to tell a flat solid from a folded one.
function stepSize(step: Buffer) {
  const text = step.toString("latin1");
  const pts = [...text.matchAll(/CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  if (!pts.length) return "no points";
  const toMm = /\.MILLI\./.test(text) ? 1 : 1000;
  return [0, 1, 2].map((k) => ((Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]))) * toMm).toFixed(2)).join(" × ") + " mm";
}

async function main() {
  let flatId: string | null = null;
  let flatDeterministic: string | null = null;
  let flatBox: { x: number; y: number; z: number } | null = null;
  let foldedName = "";
  let foldedInVersion = foldedId;

  await step("1 parts list", async () => {
    const parts: any[] = await call(`parts/${studio}?includeFlatParts=true`);
    writeFileSync(`${OUT}/parts.json`, JSON.stringify(parts, null, 2));
    const folded = parts.find((p) => p.partId === foldedId);
    const flat = parts.find((p) => p.isFlattenedBody && p.unflattenedPartId === foldedId);
    flatId = flat?.partId ?? null;
    foldedName = folded?.name ?? "";
    return `folded ${folded ? `"${folded.name}"` : "NOT FOUND"}, flat body ${flat ? `${flat.partId} ("${flat.name}", ${flat.bodyType})` : "NOT FOUND"}`;
  });
  if (!flatId) {
    console.log("\nNo flat body for that part: is it active Onshape Sheet Metal?");
    process.exit(1);
  }

  await step("2 insertables", async () => {
    if (wvm !== "w") return "skipped (needs a workspace link)";
    const list: any = await call(`documents/d/${did}/w/${wvmid}/insertables?includeParts=true&includeFlattenedBodies=true&includeSketches=false&includeSurfaces=false`);
    const items: any[] = list.items ?? list ?? [];
    writeFileSync(`${OUT}/insertables.json`, JSON.stringify(list, null, 2));
    const mine = items.filter((i) => i.elementId === eid && (i.partId === flatId || i.partId === foldedId || i.isFlattenedBody));
    const flat = mine.find((i) => i.isFlattenedBody && (i.unflattenedPartDeterministicId === foldedId || i.deterministicId === flatId));
    flatDeterministic = flat?.deterministicId ?? null;
    return mine.map((i) => `${i.partId ?? "?"}${i.isFlattenedBody ? " (flat)" : ""} deterministicId=${i.deterministicId ?? "-"}`).join("; ") || "no entries for this Part Studio";
  });

  if (!only7) await reads();
  async function reads() {
  await step("3 tessellation of the flat body", async () => {
    const answer: any = await call(`partstudios/${studio}/tessellatedfaces?partId=${encodeURIComponent(flatId!)}&outputFaceNormals=false`);
    writeFileSync(`${OUT}/flat-tessellation.json`, JSON.stringify(answer).slice(0, 5_000_000));
    // v10 answers an object with `bodies`; vertices are {x, y, z} in metres.
    const bodies: any[] = Array.isArray(answer) ? answer : (answer.bodies ?? []);
    let n = 0;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const b of bodies)
      for (const f of b.faces ?? [])
        for (const t of f.facets ?? [])
          for (const v of t.vertices ?? []) {
            n++;
            const xyz = Array.isArray(v) ? v : [v.x, v.y, v.z];
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k], xyz[k]);
              hi[k] = Math.max(hi[k], xyz[k]);
            }
          }
    if (!n) return "no facets returned";
    const size = hi.map((h, k) => mm(h - lo[k])).sort((a, b) => a - b);
    return `${n} vertices, size ${size[2]} × ${size[1]} × ${size[0]} mm (smallest = sheet thickness), z from ${mm(lo[2])} to ${mm(hi[2])} mm`;
  });

  await step("4 bounding box of the flat body", async () => {
    const b: any = await call(`parts/${studio}/partid/${encodeURIComponent(flatId!)}/boundingboxes`);
    flatBox = { x: mm(b.highX - b.lowX), y: mm(b.highY - b.lowY), z: mm(b.highZ - b.lowZ) };
    return `${flatBox.x} × ${flatBox.y} × ${flatBox.z} mm, low corner z ${mm(b.lowZ)} mm`;
  });

  await step("5 STEP of the flat body", async () => {
    const file = await translate(`partstudios/${studio}/translations`, { formatName: "STEP", partIds: flatId });
    writeFileSync(`${OUT}/flat.step`, file);
    return `${file.length} bytes, ${solids(file)} solid(s), extent ${stepSize(file)}`;
  });

  // The app's DXF_FLAT download sends the first of these; the others are variants named for a
  // sheet metal flat in forum posts and the API explorer.
  const dxfTries: [string, Record<string, unknown>][] = [
    ["flat body", { formatName: "DXF", partIds: flatId }],
    ["flat body sheetMetalFlat", { formatName: "DXF", partIds: flatId, sheetMetalFlat: true }],
    ["folded part sheetMetalFlat", { formatName: "DXF", partIds: foldedId, sheetMetalFlat: true }],
    ["flat body DXF 2013 mm", { formatName: "DXF", partIds: flatId, versionString: "2013", unit: "MILLIMETER", flattenAssemblies: false }],
  ];
  for (const [label, params] of dxfTries) {
    const name = `6 DXF (${label})`;
    await step(name, async () => {
      const file = await translate(`partstudios/${studio}/translations`, params);
      writeFileSync(`${OUT}/flat-${label.replace(/ /g, "-")}.dxf`, file);
      const text = file.toString("latin1");
      return `${file.length} bytes, ${(text.match(/\nLINE\r?\n/g) ?? []).length} lines, ${(text.match(/\n(ARC|CIRCLE)\r?\n/g) ?? []).length} arcs/circles`;
    });
    if (results[name].startsWith("OK")) break;
  }
  }

  if (write) {
    await step("7 flat body inserted into a scratch assembly, exported as STEP", async () => {
      // A cross-document insert needs a saved version of the source (a microversion is refused:
      // "Linked document references require a version identifier"). From a workspace link, the
      // document's latest version, checked to still hold the flat body.
      let versionId = wvm === "v" ? wvmid : null;
      if (!versionId) {
        const versions: any[] = await call(`documents/d/${did}/versions`);
        versionId = versions.at(-1)?.id ?? null;
        if (!versionId) throw new Error("the document has no saved versions");
        const there: any[] = await call(`parts/d/${did}/v/${versionId}/e/${eid}?includeFlatParts=true`);
        writeFileSync(`${OUT}/parts-latest-version.json`, JSON.stringify(there, null, 2));
        // Part ids can differ between the workspace and a version: fall back to the part's name.
        const folded = there.find((p) => p.partId === foldedId && !p.isFlattenedBody) ?? there.find((p) => !p.isFlattenedBody && p.name === foldedName);
        const flat = folded && there.find((p) => p.isFlattenedBody && p.unflattenedPartId === folded.partId);
        console.log(`  version "${versions.at(-1)?.name}": folded ${folded ? folded.partId : "missing"}, flat body ${flat?.partId ?? "missing"}, ${there.filter((p) => p.isFlattenedBody).length} flat bodies in all`);
        if (!flat) throw new Error(`the latest version has no flat body for ${foldedId}`);
        flatId = flat.partId;
        foldedInVersion = folded.partId;
      }
      // --scratch <document id> reuses a scratch document from an earlier run.
      const reuse = args[args.indexOf("--scratch") + 1];
      const doc: any = args.includes("--scratch") ? await call(`documents/${reuse}`) : await call("documents", { method: "POST", body: { name: `OrbitParts sheet metal spike ${new Date().toISOString().slice(0, 16)}`, isPublic: false } });
      const wid = doc.defaultWorkspace.id;
      const asm: any = await call(`assemblies/d/${doc.id}/w/${wid}`, { method: "POST", body: { name: "Flat insert test" } });
      const a = `d/${doc.id}/w/${wid}/e/${asm.id}`;
      const source = { documentId: did, elementId: eid, isAssembly: false, isWholePartStudio: false, versionId };
      const tried: string[] = [];
      // The flat body placed (as Onshape Layout inserts), then a plain insert, then the folded
      // part as a control that the call itself is right.
      const tries: [string, string, Record<string, unknown>][] = [
        ["flat, placed", "transformedinstances", { transformGroups: [{ instances: [{ ...source, partId: flatId }], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }],
        ["flat, plain insert", "instances", { ...source, partId: flatId }],
        ["folded (control)", "instances", { ...source, partId: foldedInVersion }],
      ];
      for (const [label, endpoint, body] of tries) {
        try {
          await call(`assemblies/${a}/${endpoint}`, { method: "POST", body });
          tried.push(`${label}: inserted`);
        } catch (e) {
          tried.push(`${label}: ${(e as Error).message.replace(/\s+/g, " ").slice(0, 500)}`);
        }
      }
      console.log(`  flat body's insertable deterministicId: ${flatDeterministic ?? "none"}`);
      const def: any = await call(`assemblies/${a}`);
      writeFileSync(`${OUT}/assembly.json`, JSON.stringify(def, null, 2));
      const inst = def.rootAssembly?.instances ?? [];
      let tail = "";
      if (inst.length) {
        const b: any = await call(`assemblies/${a}/boundingboxes`);
        const box = [mm(b.highX - b.lowX), mm(b.highY - b.lowY), mm(b.highZ - b.lowZ)];
        const file = await translate(`assemblies/${a}/translations`, { formatName: "STEP", flattenAssemblies: false });
        writeFileSync(`${OUT}/assembly.step`, file);
        tail = `; assembly box ${box.join(" × ")} mm (flat body alone: ${flatBox ? `${flatBox.x} × ${flatBox.y} × ${flatBox.z}` : "?"}); STEP ${file.length} bytes, ${solids(file)} solid(s)`;
      }
      return `${tried.join(" | ")}; ${inst.length} instance(s) [${inst.map((i: any) => `${i.name} partId=${i.partId}`).join(", ")}]${tail}; scratch document ${base}/documents/${doc.id}`;
    });
  }

  console.log(`\n${calls} Onshape calls. Raw answers and files in ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
