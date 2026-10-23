import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { listCategories } from "@/lib/data/categories";
import { imageHash } from "@/lib/images/dhash";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { logAiAction, type ReviewSource } from "@/lib/review/review";
import { getObject, storageConfigured } from "@/lib/storage/r2";
import { categoryOf, getCategory } from "./categories";
import { bestLinks, type LinkItem, type LinkPart } from "./linkScore";
import { onshapeKeyOf } from "./match";

const { parts, systems, robots, inventoryItems, partReviews, inventoryLinkRejections } = schema;

const HASH = /^[0-9a-f]{16}$/;
// Thumbnails fingerprinted per run, at most (each is one R2 read).
const HASH_BUDGET = 120;

// Auto-link (Harel, 2026-10-23): when an item is added or edited, from the item window's "Find
// BOM parts", and for new BOM parts on Onshape sync. Every BOM part with no item (set up or
// not, except In-house parts) is scored against every item (src/lib/inventory/linkScore.ts).
// The best clear match waits in To Review, not linked yet: Approve links it, Reject drops it
// and the pair isn't suggested again. Pass the parts or items that just changed to look only at
// those. Returns how many links it suggested.
export async function autoLink(scope: { partIds?: string[]; itemIds?: string[] }, ctx: { memberId: string | null; via: "ui" | "mcp" | "sync" }) {
  const { found, names } = await findLinks(scope);
  return writePendingLinks(
    found.map((l) => ({ partId: l.partId, itemId: l.itemId, reason: `Link to "${names.get(l.itemId)}": ${l.why.join(", ")}` })),
    { memberId: ctx.memberId, source: "rule", via: ctx.via === "sync" ? "ui" : ctx.via },
  );
}

// Auto-link's guesses, without writing them (inventory_to_link shows them to a member's Claude).
export async function findLinks(scope: { partIds?: string[]; itemIds?: string[] }) {
  const none = { found: [] as ReturnType<typeof bestLinks>, names: new Map<string, string>() };
  if ((scope.partIds && !scope.partIds.length) || (scope.itemIds && !scope.itemIds.length)) return none;
  const [candidates, items, linked, waiting, rejected, cats] = await Promise.all([
    db
      .select({
        id: parts.id,
        displayName: parts.displayName,
        onshapeName: parts.onshapeName,
        sourceDid: parts.sourceDid,
        sourceEid: parts.sourceEid,
        onshapePartId: parts.onshapePartId,
        cotsLinks: parts.cotsLinks,
        thumbnailRev: parts.thumbnailRev,
        thumbHash: parts.thumbHash,
      })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .innerJoin(robots, eq(robots.id, systems.robotId))
      .where(
        and(
          isNull(parts.inventoryItemId),
          isNull(parts.removedFromCadAt),
          ne(parts.classification, "inhouse"),
          eq(robots.archived, false),
          scope.partIds ? inArray(parts.id, scope.partIds) : undefined,
        ),
      ),
    db.select().from(inventoryItems),
    db
      .select({ id: parts.id, itemId: parts.inventoryItemId, displayName: parts.displayName, onshapeName: parts.onshapeName, sourceDid: parts.sourceDid, sourceEid: parts.sourceEid, thumbnailRev: parts.thumbnailRev, thumbHash: parts.thumbHash })
      .from(parts)
      .where(and(isNotNull(parts.inventoryItemId), isNull(parts.removedFromCadAt))),
    db.select({ partId: partReviews.partId, pending: partReviews.pending }).from(partReviews),
    db.select().from(inventoryLinkRejections),
    listCategories(),
  ]);
  const hasPending = new Set(waiting.filter((w) => w.pending.inventoryItemId).map((w) => w.partId));
  const open = candidates.filter((p) => !hasPending.has(p.id));
  if (!open.length || !items.length) return none;

  // Fingerprint thumbnails not done yet: the scoped items' linked parts first, then the rest.
  const inScope = new Set(scope.itemIds ?? items.map((i) => i.id));
  const hashes = await fillThumbHashes([...linked.filter((l) => inScope.has(l.itemId!)), ...open]);
  const hashOf = (p: { id: string; thumbHash: string | null }) => {
    const h = hashes.get(p.id) ?? p.thumbHash;
    return h && HASH.test(h) ? h : null;
  };

  const byItem = new Map<string, typeof linked>();
  for (const l of linked) byItem.set(l.itemId!, [...(byItem.get(l.itemId!) ?? []), l]);
  const linkItems: LinkItem[] = items.map((i) => {
    const mine = byItem.get(i.id) ?? [];
    return {
      id: i.id,
      name: i.name,
      aliases: i.aliases,
      category: getCategory(cats, categoryOf(i, cats)),
      specs: i.specs,
      urls: i.cotsLinks.map((l) => l.url),
      onshapeKey: i.onshapeKey,
      docKeys: [...new Set(mine.flatMap((l) => (l.sourceDid && l.sourceEid ? [`${l.sourceDid}:${l.sourceEid}`] : [])))],
      thumbHashes: mine.flatMap((l) => {
        const hash = hashOf(l);
        return hash ? [{ hash, partName: l.displayName ?? l.onshapeName ?? "a linked part" }] : [];
      }),
    };
  });
  const linkParts: LinkPart[] = open.map((p) => ({
    id: p.id,
    names: [p.displayName, p.onshapeName].filter((n): n is string => !!n),
    onshapeKey: onshapeKeyOf(p),
    docKey: p.sourceDid && p.sourceEid ? `${p.sourceDid}:${p.sourceEid}` : null,
    urls: p.cotsLinks.map((l) => l.url),
    thumbHash: hashOf(p),
  }));
  const no = new Set(rejected.map((r) => `${r.partId}:${r.itemId}`));
  const names = new Map(items.map((i) => [i.id, i.name]));
  const found = bestLinks(linkParts, linkItems, (p, i) => no.has(`${p}:${i}`)).filter((l) => inScope.has(l.itemId));
  return { found, names };
}

// Puts suggested links in To Review without linking (the part keeps no item until Approve).
// Merges into a review the part already has; a site rule adding to an AI's review keeps the AI's
// run and name. Used by auto-link and by a member's Claude (link_inventory).
export async function writePendingLinks(
  links: { partId: string; itemId: string; reason: string | null }[],
  ctx: { memberId: string | null; source: ReviewSource; via: "ui" | "mcp"; aiName?: string },
) {
  if (!links.length) return 0;
  const batchId = randomUUID();
  await db.transaction(async (tx) => {
    for (const l of links) {
      const [existing] = await tx.select().from(partReviews).where(eq(partReviews.partId, l.partId)).for("update");
      const keep = existing && existing.source === "ai" && ctx.source === "rule";
      const values = {
        source: keep ? existing.source : ctx.source,
        reason: existing ? [existing.reason, l.reason].filter(Boolean).join(" · ") || null : l.reason,
        changes: existing?.changes ?? {},
        pending: { ...(existing?.pending ?? {}), inventoryItemId: l.itemId },
        memberId: keep ? existing.memberId : ctx.memberId,
        batchId: keep ? existing.batchId : batchId,
        aiName: keep ? existing.aiName : (ctx.aiName ?? null),
        createdAt: new Date(),
      };
      await tx.insert(partReviews).values({ partId: l.partId, ...values }).onConflictDoUpdate({ target: partReviews.partId, set: values });
    }
  });
  await logAiAction({
    source: ctx.source,
    tool: ctx.source === "rule" ? "Auto-link" : "link_inventory",
    memberId: ctx.memberId,
    aiName: ctx.aiName,
    batchId,
    parts: links.length,
    summary: `Suggested ${links.length} inventory link${links.length === 1 ? "" : "s"}; they wait in To Review`,
  });
  return links.length;
}

// Thumbnail fingerprints for parts that have a thumbnail but no fingerprint yet, saved on the
// part. A picture that can't be read is saved as "-" so it isn't read again.
async function fillThumbHashes(rows: { id: string; thumbnailRev: string | null; thumbHash: string | null }[]) {
  const out = new Map<string, string>();
  if (!storageConfigured()) return out;
  const todo = [...new Map(rows.filter((r) => r.thumbnailRev && !r.thumbHash).map((r) => [r.id, r])).values()].slice(0, HASH_BUDGET);
  const worker = async () => {
    for (let r = todo.shift(); r; r = todo.shift()) {
      try {
        const res = await getObject(thumbKey(r.id, r.thumbnailRev!));
        const hash = (res && imageHash(new Uint8Array(await res.arrayBuffer()))) || "-";
        await db.update(parts).set({ thumbHash: hash }).where(eq(parts.id, r.id));
        out.set(r.id, hash);
      } catch {
        // Try again next run.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}
