import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";

// A robot's Batch Layouts document: the Onshape document where its batches' "Batch - <name>"
// assemblies are made (Harel, 2026-10-31). Stored as the document link, its id and the workspace
// the tabs go in.
export type LayoutsDocument = { url: string; did: string; wid: string };

// From any link into the document. A workspace link needs no Onshape call; a version link asks
// Onshape once for the document's main workspace.
export async function resolveLayoutsDocument(link: string, member: { id: string; onshapeConnected: boolean }): Promise<LayoutsDocument | { error: string }> {
  const ref = parseOnshapeUrl(link);
  if (!ref) return { error: "Paste a link to an Onshape document (…onshape.com/documents/…)." };
  let wid = ref.wvm === "w" ? ref.wvmid : null;
  if (!wid) {
    if (!member.onshapeConnected) return { error: "Paste the document's workspace link (…/w/…), or connect Onshape on your profile." };
    try {
      wid = (await onshapeClient(member.id, ref.baseUrl).json<{ defaultWorkspace?: { id: string } }>(`documents/${ref.did}`)).defaultWorkspace?.id ?? null;
    } catch (err) {
      if (err instanceof OnshapeError) return { error: err.message };
      throw err;
    }
    if (!wid) return { error: "Couldn't find that document's main workspace." };
  }
  return { url: `${ref.baseUrl}/documents/${ref.did}/w/${wid}`, did: ref.did, wid };
}

// Saves (or, with an empty link, clears) a robot's Batch Layouts document.
export async function saveLayoutsDocument(robotId: string, link: string, member: { id: string; onshapeConnected: boolean }): Promise<{ error?: string; saved?: boolean }> {
  if (!z.uuid().safeParse(robotId).success) return { error: "Pick a robot." };
  let doc: { url: string | null; did: string | null; wid: string | null } = { url: null, did: null, wid: null };
  if (link.trim()) {
    const r = await resolveLayoutsDocument(link, member);
    if ("error" in r) return { error: r.error };
    doc = r;
  }
  await db
    .update(schema.robots)
    .set({ layoutsDocumentUrl: doc.url, layoutsDocumentId: doc.did, layoutsWorkspaceId: doc.wid })
    .where(eq(schema.robots.id, robotId));
  return { saved: true };
}
