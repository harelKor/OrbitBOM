import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listCategories } from "./categories";
import { pageName, type RecentAction } from "./actions";

const { inventoryMoves, inventoryItemHistory, inventoryLocations, inventoryConditions, dismissedActions, members, systems } = schema;

const KEEP_DAYS = 7;

// Inventory's Recent actions, like the robot dashboard's: each page visit in which someone
// changed the inventory (stock, added or edited items), newest first, a week back, less the ones
// this member closed. thumbs carry item ids; the page fills in their pictures.
export async function listInventoryActions(memberId: string, limit = 9): Promise<RecentAction[]> {
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000);
  // Both tables have the same visit columns; one query shape for each.
  const grouped = (table: typeof inventoryMoves | typeof inventoryItemHistory, kind: ReturnType<typeof sql<string>>) => {
    const t = table as typeof inventoryMoves;
    return db
      .select({
        visitId: sql<string>`${t.visitId}`,
        page: sql<string>`max(${t.page})`,
        memberId: sql<string | null>`(array_agg(${t.memberId} order by ${t.at} desc))[1]`,
        at: sql<Date>`max(${t.at})`.mapWith((v: string | Date) => new Date(v)),
        kinds: sql<string[]>`array_agg(distinct ${kind})`,
        itemIds: sql<string[]>`array_agg(${t.itemId} order by ${t.at} desc)`,
      })
      .from(t)
      .where(
        and(
          isNotNull(t.visitId),
          gte(t.at, since),
          notExists(
            db
              .select({ one: sql`1` })
              .from(dismissedActions)
              .where(and(eq(dismissedActions.memberId, memberId), eq(dismissedActions.visitId, t.visitId))),
          ),
        ),
      )
      .groupBy(t.visitId)
      .orderBy(desc(sql`max(${t.at})`))
      .limit(limit);
  };
  const [moves, edits] = await Promise.all([
    grouped(inventoryMoves, sql<string>`'Stock'`),
    grouped(inventoryItemHistory, sql<string>`case when ${inventoryItemHistory.field} = 'created' then 'Added' else 'Edited' end`),
  ]);

  const visits = new Map<string, (typeof moves)[number]>();
  for (const v of [...edits, ...moves]) {
    const had = visits.get(v.visitId);
    if (!had) visits.set(v.visitId, { ...v });
    else
      visits.set(v.visitId, {
        ...had,
        at: v.at > had.at ? v.at : had.at,
        memberId: v.at > had.at ? v.memberId : had.memberId,
        kinds: [...new Set([...had.kinds, ...v.kinds])],
        itemIds: v.at > had.at ? [...v.itemIds, ...had.itemIds] : [...had.itemIds, ...v.itemIds],
      });
  }
  const list = [...visits.values()].sort((a, b) => +b.at - +a.at).slice(0, limit);
  if (!list.length) return [];

  const memberIds = [...new Set(list.flatMap((v) => (v.memberId ? [v.memberId] : [])))];
  const [names, cats, locations, conditions, systemRows] = await Promise.all([
    memberIds.length ? db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds)) : [],
    listCategories(),
    db.select({ id: inventoryLocations.id, name: inventoryLocations.name }).from(inventoryLocations),
    db.select({ id: inventoryConditions.id, label: inventoryConditions.label }).from(inventoryConditions),
    db.select({ id: systems.id, name: systems.name }).from(systems),
  ]);
  const memberName = new Map(names.map((m) => [m.id, m.name]));
  const systemName = new Map(systemRows.map((s) => [s.id, s.name]));
  const nameOf = (page: string) => {
    const path = page.split(/[?#]/)[0];
    const [, kind, id] = /^\/inventory\/(c|location|condition)\/([^/]+)/.exec(path) ?? [];
    if (kind === "c") return cats.find((c) => c.id === decodeURIComponent(id))?.label ?? "Inventory";
    if (kind === "location") return locations.find((l) => l.id === id)?.name ?? "Inventory";
    if (kind === "condition") return conditions.find((c) => c.id === id)?.label ?? "Inventory";
    if (path.startsWith("/inventory/short")) return "Short for robots";
    return pageName(page, systemName);
  };
  const ORDER = ["Added", "Stock", "Edited"];
  return list.map((v) => {
    const ids = [...new Set(v.itemIds)];
    return {
      visitId: v.visitId,
      page: v.page,
      pageName: nameOf(v.page),
      memberName: v.memberId ? (memberName.get(v.memberId) ?? null) : null,
      at: v.at,
      fields: ORDER.filter((k) => v.kinds.includes(k)),
      statusTo: null,
      partCount: ids.length,
      firstPartId: ids[0],
      thumbs: ids.slice(0, 6).map((id) => ({ id, name: "", url: null })),
    };
  });
}
