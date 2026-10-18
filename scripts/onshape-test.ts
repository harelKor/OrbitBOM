/* eslint-disable @typescript-eslint/no-explicit-any -- raw Onshape API responses */
/**
 * Onshape test (plan §7, week of Oct 19): pull one real system the way the app will, and count
 * the API calls each step costs. Read-only: it never writes to Onshape.
 *
 *   npm run onshape:test -- "<assembly URL>" [--parts 5] [--no-export]
 *
 * Auth, from .env.local or the environment (either one):
 *   ONSHAPE_ACCESS_KEY + ONSHAPE_SECRET_KEY   API keys from the Developer Portal (dev-portal.onshape.com/keys)
 *   ONSHAPE_TOKEN                             an OAuth access token
 *
 * Prints a report and saves the raw responses to scripts/out/ (git-ignored).
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { apiPath, parseOnshapeUrl } from "../src/lib/onshape/url";

config({ path: ".env.local" });
config();

const args = process.argv.slice(2);
const assemblyUrl = args.find((a) => !a.startsWith("--"));
const partsArg = args.indexOf("--parts");
const maxParts = partsArg >= 0 ? Number(args[partsArg + 1]) : 5;
const doExport = !args.includes("--no-export");

if (!assemblyUrl) {
  console.error('Usage: npm run onshape:test -- "<assembly URL>" [--parts 5] [--no-export]');
  process.exit(1);
}
const root = parseOnshapeUrl(assemblyUrl);
if (!root?.eid) {
  console.error("That doesn't look like an Onshape element URL (…/documents/<d>/w/<w>/e/<e>).");
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

// ---------- counted fetch ----------

type Step = { name: string; calls: number; ok: boolean; note?: string };
const steps: Step[] = [];
let current: Step | null = null;
const raw: Record<string, unknown> = {};
const rateHeaders = new Set<string>();

async function call(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  let url = path.startsWith("http") ? path : `${root!.baseUrl}/api/v10/${path}`;
  // Follow redirects by hand so every request Onshape serves is counted.
  for (let hop = 0; hop < 5; hop++) {
    const sameHost = new URL(url).hostname.endsWith("onshape.com");
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        Accept: init.accept ?? "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(sameHost ? { Authorization: authHeader! } : {}),
        ...init.headers,
      },
    });
    if (sameHost && current) current.calls++;
    res.headers.forEach((v, k) => {
      if (/rate|limit|remaining/i.test(k)) rateHeaders.add(`${k}: ${v}`);
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

async function json<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await call(path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  current = { name, calls: 0, ok: false };
  steps.push(current);
  process.stdout.write(`• ${name} … `);
  try {
    const result = await fn();
    current.ok = true;
    console.log(`ok (${current.calls} call${current.calls === 1 ? "" : "s"})${current.note ? ` ${current.note}` : ""}`);
    return result;
  } catch (err) {
    current.note = (err as Error).message;
    console.log(`FAILED (${current.calls} calls)\n    ${current.note}`);
    return undefined;
  } finally {
    current = null;
  }
}

const note = (text: string) => {
  if (current) current.note = text;
};

// ---------- the test ----------

type StudioRef = { did: string; eid: string; mv: string };
type BomRow = {
  headerIdToValue: Record<string, unknown>;
  itemSource?: { documentId: string; elementId: string; partId?: string; wvmType?: string; wvmId?: string };
};

async function main() {
  console.log(`\nOnshape test for ${assemblyUrl}\n`);

  // 1. Change check: the document's current microversion. The app does this on every refresh.
  await step("Change check (document microversion)", async () => {
    if (root!.wvm !== "w") {
      note("(versions never change; skipped)");
      return;
    }
    const mv = await json(`documents/d/${root!.did}/w/${root!.wvmid}/currentmicroversion`);
    raw.microversion = mv;
    note(`→ ${mv.microversion}`);
  });

  // 2. Discover subassemblies and part studios (New system dialog / "Update URLs from Onshape").
  const studios = new Map<string, StudioRef>();
  await step("Discover subassemblies and part studios", async () => {
    const def = await json(`assemblies/${apiPath(root!)}?includeMateFeatures=false&includeNonSolids=false`);
    raw.assemblyDefinition = def;
    for (const p of def.parts ?? []) {
      studios.set(`${p.documentId}/${p.elementId}`, {
        did: p.documentId,
        eid: p.elementId,
        mv: p.documentMicroversion,
      });
    }
    const docs = new Set([...studios.values()].map((s) => s.did));
    note(`→ ${def.subAssemblies?.length ?? 0} subassemblies, ${studios.size} part studios in ${docs.size} documents`);
  });

  // 3. Update BOM: the flattened assembly BOM with every column, custom properties included.
  let rows: BomRow[] = [];
  let headers: { id: string; name: string; propertyName?: string }[] = [];
  await step("Update BOM (assembly BOM with properties)", async () => {
    const bom = await json(
      `assemblies/${apiPath(root!)}/bom?indented=false&multiLevel=false&generateIfAbsent=true`,
    );
    raw.bom = bom;
    headers = bom.headers ?? [];
    rows = bom.rows ?? [];
    note(`→ ${rows.length} rows, ${headers.length} columns`);
  });

  // 4. Geometry for classification: parts (body type), mass properties, bounding boxes.
  const studioList = [...studios.values()];
  const firstStudio = studioList[0];
  let sampleParts: { partId: string; name: string; bodyType?: string; thumbnailInfo?: any }[] = [];
  if (firstStudio) {
    const studioPath = `d/${firstStudio.did}/m/${firstStudio.mv}/e/${firstStudio.eid}`;
    await step("Geometry: parts list for one part studio (body type, thumbnails)", async () => {
      sampleParts = await json(`parts/${studioPath}?withThumbnails=true`);
      raw.parts = sampleParts;
      const types = [...new Set(sampleParts.map((p) => p.bodyType))].join(", ");
      note(`→ ${sampleParts.length} parts (body types: ${types})`);
    });
    await step("Geometry: mass properties for the whole part studio", async () => {
      const mass = await json(`partstudios/${studioPath}/massproperties?massAsGroup=false`);
      raw.massProperties = mass;
      note(`→ ${Object.keys(mass.bodies ?? {}).length} bodies`);
    });
    await step(`Geometry: bounding box per part (first ${maxParts})`, async () => {
      raw.boundingBoxes = {};
      for (const p of sampleParts.slice(0, maxParts)) {
        (raw.boundingBoxes as any)[p.partId] = await json(
          `parts/${studioPath}/partid/${encodeURIComponent(p.partId)}/boundingboxes`,
        );
      }
    });
    await step("Thumbnail: one part image", async () => {
      const href = sampleParts
        .flatMap((p) => p.thumbnailInfo?.sizes ?? [])
        .find((s: any) => s.size === "300x300" || s.size === "300x170")?.href;
      if (!href) throw new Error("no thumbnail href in the parts list");
      const res = await call(href, { accept: "image/*" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      note(`→ ${(await res.arrayBuffer()).byteLength} bytes`);
    });

    if (doExport && sampleParts[0]) {
      const pid = encodeURIComponent(sampleParts[0].partId);
      await step("Export: STL of one part (synchronous)", async () => {
        const res = await call(`parts/${studioPath}/partid/${pid}/stl?mode=binary&units=millimeter`, {
          accept: "*/*",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        note(`→ ${(await res.arrayBuffer()).byteLength} bytes`);
      });
      await step("Export: STEP of one part (translation: start, poll, download)", async () => {
        // Translations take a workspace or version, so use the BOM row's source when there is one.
        const src = rows.find((r) => r.itemSource?.partId === sampleParts[0].partId)?.itemSource;
        const path =
          src?.wvmType && src.wvmId
            ? `d/${src.documentId}/${src.wvmType}/${src.wvmId}/e/${src.elementId}`
            : studioPath;
        let t = await json(`partstudios/${path}/translations`, {
          method: "POST",
          body: JSON.stringify({ formatName: "STEP", partIds: sampleParts[0].partId, storeInDocument: false }),
        });
        for (let i = 0; i < 30 && t.requestState === "ACTIVE"; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          t = await json(`translations/${t.id}`);
        }
        if (t.requestState !== "DONE") throw new Error(`translation ${t.requestState}: ${t.failureReason ?? ""}`);
        const res = await call(`documents/d/${t.documentId}/externaldata/${t.resultExternalDataIds[0]}`, {
          accept: "*/*",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        note(`→ ${(await res.arrayBuffer()).byteLength} bytes`);
      });
    }
  }

  // ---------- report ----------

  console.log("\nBOM columns (copy the propertyIds for Material and the processes into src/config/onshapeProperties.ts):");
  for (const h of headers) console.log(`  ${h.name.padEnd(28)} ${h.id}${h.propertyName ? `  (${h.propertyName})` : ""}`);

  if (rows.length) {
    console.log("\nFirst BOM rows:");
    const show = headers.filter((h) => /name|material|process|quantity|description/i.test(h.name));
    for (const r of rows.slice(0, 5)) {
      console.log("  " + show.map((h) => `${h.name}=${fmt(r.headerIdToValue[h.id])}`).join(" | "));
    }
  }

  const total = steps.reduce((n, s) => n + s.calls, 0);
  console.log("\nCalls per step:");
  for (const s of steps) console.log(`  ${String(s.calls).padStart(3)}  ${s.ok ? " " : "✗"} ${s.name}`);
  console.log(`  ${String(total).padStart(3)}    total`);

  const bboxStep = steps.find((s) => s.name.startsWith("Geometry: bounding box"));
  if (bboxStep?.ok && sampleParts.length) {
    const perPart = bboxStep.calls / Math.min(maxParts, sampleParts.length);
    console.log(`\nBounding boxes cost ${perPart} call per part; this studio alone would need ${Math.ceil(perPart * sampleParts.length)}.`);
  }
  console.log(`Part studios in this system: ${studioList.length}.`);
  if (rateHeaders.size) console.log(`\nRate-limit headers seen:\n  ${[...rateHeaders].join("\n  ")}`);

  mkdirSync("scripts/out", { recursive: true });
  const file = `scripts/out/onshape-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ assemblyUrl, steps, rateHeaders: [...rateHeaders], raw }, null, 2));
  console.log(`\nRaw responses saved to ${file}`);
}

function fmt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
  return String(v);
}

main().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});
