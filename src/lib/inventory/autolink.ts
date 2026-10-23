import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { applySuggestions, logAiAction } from "@/lib/review/review";
import { suggestItem } from "./match";

const { parts, inventoryItems } = schema;

const WHY = { onshape: "same Onshape part", link: "same product link" } as const;

// Auto-link, always on (Harel, 2026-10-23): BOM parts with no item are linked to the item that is
// the same Onshape library part or has the same product link. Each link waits in To Review like
// an AI change; Reject unlinks it. Name matches stay suggestions only. Pass the parts or items
// that just changed to look only at those.
export async function autoLink(scope: { partIds?: string[]; itemIds?: string[] }, ctx: { memberId: string | null; via: "ui" | "mcp" | "sync" }) {
  if ((scope.partIds && !scope.partIds.length) || (scope.itemIds && !scope.itemIds.length)) return 0;
  const [candidates, items] = await Promise.all([
    db
      .select({
        id: parts.id,
        displayName: parts.displayName,
        onshapeName: parts.onshapeName,
        sourceDid: parts.sourceDid,
        sourceEid: parts.sourceEid,
        onshapePartId: parts.onshapePartId,
        cotsLinks: parts.cotsLinks,
      })
      .from(parts)
      .where(and(isNull(parts.inventoryItemId), isNull(parts.removedFromCadAt), scope.partIds ? inArray(parts.id, scope.partIds) : undefined)),
    db
      .select({ id: inventoryItems.id, name: inventoryItems.name, onshapeKey: inventoryItems.onshapeKey, aliases: inventoryItems.aliases, cotsLinks: inventoryItems.cotsLinks })
      .from(inventoryItems)
      .where(scope.itemIds ? inArray(inventoryItems.id, scope.itemIds) : undefined),
  ]);
  if (!candidates.length || !items.length) return 0;
  const names = new Map(items.map((i) => [i.id, i.name]));
  const edits = candidates.flatMap((p) => {
    // Names don't count here: only the Onshape part or the product link.
    const hit = suggestItem({ ...p, displayName: null, onshapeName: null }, items);
    if (!hit || hit.reason === "name") return [];
    return [{ id: p.id, changes: { inventoryItemId: hit.itemId }, reason: `Auto-link to "${names.get(hit.itemId)}": ${WHY[hit.reason]}` }];
  });
  if (!edits.length) return 0;
  const { changed, batchId } = await applySuggestions(edits, { memberId: ctx.memberId, source: "rule", via: ctx.via === "sync" ? "ui" : ctx.via });
  if (changed) await logAiAction({ source: "rule", tool: "Auto-link", memberId: ctx.memberId, batchId, parts: changed, summary: `Linked ${changed} BOM part${changed === 1 ? "" : "s"} to inventory items` });
  return changed;
}
