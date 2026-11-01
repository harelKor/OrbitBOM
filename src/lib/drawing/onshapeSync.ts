import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient } from "@/lib/onshape/client";
import { exportDrawingPdf } from "@/lib/onshape/export";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { onshapeDrawingKey, replacePartFile } from "@/lib/parts/files";
import { putObject } from "@/lib/storage/r2";

const { parts, partFiles, systems } = schema;

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

// Pull the official drawings from Onshape (system page → Drawings → Sync Onshape drawings). Only
// on that button, never in the background: each call counts against the Onshape app's yearly
// allowance. One elements listing per document the system's in-house parts come from, then one
// PDF export (start, poll, download) per drawing tab whose name matches a part's name or part
// number, and only when that tab changed since the last sync. The PDF becomes the part's drawing
// file, which the card's View drawing opens.
export async function syncOnshapeDrawings(systemId: string, partIds: string[] | null, memberId: string, deadline: number): Promise<OnshapeDrawingSync> {
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
      did: parts.sourceDid,
      wvm: parts.sourceWvm,
      wid: parts.sourceWid,
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

  // The documents to look in: the system's own, then those its in-house parts come from.
  const docs = new Map<string, string>([[`${ref.did}/${ref.wvm}/${ref.wvmid}`, `d/${ref.did}/${ref.wvm}/${ref.wvmid}`]]);
  for (const r of rows) {
    const wvm = r.wvm?.[0]?.toLowerCase();
    if (r.did && r.wid && wvm && "wvm".includes(wvm)) docs.set(`${r.did}/${wvm}/${r.wid}`, `d/${r.did}/${wvm}/${r.wid}`);
  }

  const client = onshapeClient(memberId, ref.baseUrl);
  // Drawing tabs by matching name; a part's own document wins over another with the same name.
  const tabs = new Map<string, { path: string; doc: string; eid: string; mv: string; name: string }[]>();
  for (const [doc, path] of docs) {
    const elements = await client.json<Element[]>(`documents/${path}/elements?elementType=DRAWING`);
    for (const e of elements) {
      if (e.elementType !== "DRAWING") continue;
      summary.found++;
      const key = drawingKey(e.name);
      if (key) tabs.set(key, [...(tabs.get(key) ?? []), { path: `${path}/e/${e.id}`, doc, eid: e.id, mv: e.microversionId ?? "", name: e.name.trim() }]);
    }
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
    const tab = options.find((t) => r.did && t.doc.startsWith(`${r.did}/`)) ?? options[0];
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
