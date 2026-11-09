import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { loadSystemReview } from "@/lib/data/cadReview";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { keptDocVersions, readDocVersions } from "@/lib/versions/docVersions";

// The Onshape version a comment written in the Onshape panel goes on (Harel, 2026-11-09): the
// version open in Onshape when the panel is on a version of the design's own document, else
// (the workspace, or a Manufacture document) the design document's newest version. Onshape is
// read (1 call) only when the kept version list doesn't know the open version or is over two
// minutes old, so reopening the panel costs nothing.

export type PanelVersion = {
  version: { id: string; name: string } | null;
  // Newer than the version the BOM is on: the tree shows it above, marked.
  ahead: boolean;
  bom: string | null; // the BOM's current version
  note: string | null; // why the version may be missing or old
};

export type PanelPlace = { did: string | null; wv: "w" | "v" | null; wvId: string | null };

const FRESH_MS = 2 * 60_000;
const OID = /^[0-9a-f]{24}$/i;

export async function panelVersion(member: Member, systemId: string, place: PanelPlace): Promise<PanelVersion | null> {
  const [[system], review] = await Promise.all([db.select({ url: schema.systems.assemblyUrl }).from(schema.systems).where(eq(schema.systems.id, systemId)), loadSystemReview(systemId)]);
  if (!system || !review) return null;
  const bom = review.current?.label ?? null;
  const asm = system.url ? parseOnshapeUrl(system.url) : null;
  const did = review.treeDid;
  if (!did || !asm) return { version: null, ahead: false, bom, note: "This system isn't linked to an Onshape assembly." };

  const opened = place.wv === "v" && place.wvId && OID.test(place.wvId) && place.did?.toLowerCase() === did ? place.wvId.toLowerCase() : null;
  let kept = await keptDocVersions(did);
  const known = opened ? !!kept?.versions.some((v) => v.id === opened) : !!kept && Date.now() - kept.at.getTime() < FRESH_MS;
  let note: string | null = null;
  let read = false;
  if (!known) {
    if (!member.onshapeConnected) note = "Connect your Onshape account (Profile → Connect Onshape) so comments go on Onshape's newest version.";
    else
      try {
        await readDocVersions(onshapeClient(member.id, asm.baseUrl), did);
        kept = await keptDocVersions(did);
        read = true;
      } catch (err) {
        if (!(err instanceof OnshapeError)) throw err;
        note = `Couldn't read Onshape's versions: ${err.message}`;
      }
  }

  const list = kept?.versions ?? [];
  const newest = list.reduce<(typeof list)[number] | null>((a, v) => (!a || v.createdAt > a.createdAt ? v : a), null);
  const picked = opened ? (list.find((v) => v.id === opened) ?? { id: opened, name: "" }) : newest;
  if (!picked) return { version: null, ahead: false, bom, note: note ?? "This design has no Onshape versions yet: make one in Onshape first." };
  const tree = read ? ((await loadSystemReview(systemId))?.tree ?? []) : review.tree;
  const node = tree.find((n) => n.key === picked.id);
  return { version: { id: picked.id, name: picked.name }, ahead: node?.ahead ?? false, bom, note };
}
