import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient } from "@/lib/onshape/client";
import { exportDrawingPdf } from "@/lib/onshape/export";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { onshapeDrawingKey, replacePartFile } from "@/lib/parts/files";
import { getObject, putObject } from "@/lib/storage/r2";
import type { OnshapeClient } from "@/lib/onshape/client";

const { parts, partFiles, systems } = schema;
const LISTING_TTL_MS = 10 * 60_000;

export type OnshapeDrawingSync = {
  linked: string[]; // part ids that got a new drawing file
  unchanged: string[]; // part ids whose Onshape drawing hasn't changed since the last sync
  left: string[]; // part ids matched but not exported before the deadline: call again with them
  found: number; // drawing tabs in the system's documents
};

type Element = { id: string; name: string; elementType: string; microversionId?: string };

// "Part 7", "part 7 drawing" and " PART 7 " all match a part named Part 7.
export const drawingKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s_-]*(drawing|dwg)$/, "")
    .trim();

// Pull the official drawings from Onshape (system page → Drawings → Sync Onshape drawings, or the
// part window's Find drawing). Only on a click, never in the background: each call counts against
// the Onshape app's yearly allowance. One listing of the drawing tabs in the system's assembly
// document (`cached`: reuse a listing up to 10 minutes old, 0 calls), then one PDF export (start,
// poll, download) per tab whose name matches a part's name or part number, and only when that tab
// changed since its last sync. The PDF becomes the part's drawing file, which View drawing opens.
export async function syncOnshapeDrawings(
  systemId: string,
  partIds: string[] | null,
  memberId: string,
  deadline: number,
  cached = false,
): Promise<OnshapeDrawingSync> {
  const summary: OnshapeDrawingSync = { linked: [], unchanged: [], left: [], found: 0 };
  const [system] = await db.select({ assemblyUrl: systems.assemblyUrl }).from(systems).where(eq(systems.id, systemId));
  const ref = system?.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  if (!ref) return summary;
  const rows = await db
    .select({
      id: parts.id,
      displayName: parts.displayName,
      onshapeName: parts.onshapeName,
      partNumber: parts.partNumber,
    })
    .from(parts)
    .where(
      and(
        eq(parts.systemId, systemId),
        isNull(parts.removedFromCadAt),
        ne(parts.classification, "cots"),
        ...(partIds ? [inArray(parts.id, partIds)] : []),
      ),
    );
  if (!rows.length) return summary;

  // Only the system's own document (its assembly's, the "manufacture" document): that's where the
  // team keeps the drawings, not in the documents the parts were first made in.
  const doc = `d/${ref.did}/${ref.wvm}/${ref.wvmid}`;
  const client = onshapeClient(memberId, ref.baseUrl);
  const elements = await drawingTabs(client, doc, cached);
  const tabs = new Map<string, { path: string; eid: string; mv: string; name: string }[]>();
  for (const e of elements) {
    summary.found++;
    const key = drawingKey(e.name);
    if (key) tabs.set(key, [...(tabs.get(key) ?? []), { path: `${doc}/e/${e.id}`, eid: e.id, mv: e.microversionId ?? "", name: e.name.trim() }]);
  }
  if (!tabs.size) return summary;

  const existing = await db
    .select({ partId: partFiles.partId, r2Key: partFiles.r2Key })
    .from(partFiles)
    .where(and(inArray(partFiles.partId, rows.map((r) => r.id)), eq(partFiles.type, "drawing")));
  const keyOf = new Map(existing.map((f) => [f.partId, f.r2Key]));

  // Each drawing tab is exported once, however many parts it matches.
  const pdfs = new Map<string, Promise<ArrayBuffer>>();
  for (const r of rows) {
    const names = [r.displayName, r.onshapeName, r.partNumber].filter((n): n is string => !!n).map(drawingKey);
    const options = names.flatMap((n) => tabs.get(n) ?? []);
    if (!options.length) continue;
    const tab = options[0];
    const key = onshapeDrawingKey(r.id, tab.eid, tab.mv);
    if (tab.mv && keyOf.get(r.id) === key) {
      summary.unchanged.push(r.id);
      continue;
    }
    if (Date.now() > deadline) {
      summary.left.push(r.id);
      continue;
    }
    if (!pdfs.has(tab.path)) pdfs.set(tab.path, exportDrawingPdf(client, tab.path, deadline));
    const pdf = await pdfs.get(tab.path)!;
    await putObject(key, pdf, "application/pdf");
    await replacePartFile(r.id, "drawing", { key, filename: `${tab.name}.pdf`, contentType: "application/pdf", memberId });
    summary.linked.push(r.id);
  }
  return summary;
}

// The document's drawing tabs. The listing is kept in R2, so a run of Find drawing clicks within
// 10 minutes lists the document once.
async function drawingTabs(client: OnshapeClient, doc: string, cached: boolean): Promise<Element[]> {
  const key = `cache/drawing-tabs/${doc.replace(/\//g, "_")}.json`;
  if (cached) {
    const hit = await getObject(key).catch(() => null);
    const saved = hit ? ((await hit.json().catch(() => null)) as { at: number; tabs: Element[] } | null) : null;
    if (saved && Date.now() - saved.at < LISTING_TTL_MS) return saved.tabs;
  }
  const elements = await client.json<Element[]>(`documents/${doc}/elements?elementType=DRAWING`);
  const tabs = elements
    .filter((e) => e.elementType === "DRAWING")
    .map(({ id, name, elementType, microversionId }) => ({ id, name, elementType, microversionId }));
  await putObject(key, new TextEncoder().encode(JSON.stringify({ at: Date.now(), tabs })), "application/json").catch(() => {});
  return tabs;
}
