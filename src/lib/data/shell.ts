import "server-only";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";
import { fabStage, machinesOf } from "@/lib/fab";
import { statusBreakdown } from "@/lib/stats";
import { listSystemSync, type SystemSync } from "@/lib/versions/sync";
import { countInventoryReviews } from "@/lib/review/inventory";

const { robots, systems, parts, partReviews } = schema;

export type ShellSystem = { id: string; name: string; assemblyUrl: string | null; percent: number; total: number; thumbUrl: string | null; sync: SystemSync };
export type ShellRobot = {
  id: string;
  name: string;
  year: number;
  code: string | null;
  mainAssemblyUrl: string | null;
  archived: boolean;
  percent: number;
  thumbUrl: string | null;
  systems: ShellSystem[];
  // Parts in process or released, in total and per machine (To Fab badges).
  fab: { total: number; byMachine: Record<string, number> };
  review: number; // parts waiting in To Review
};

// The right sidebar: every robot with its systems, completion and a picture. A system's
// picture is its stored thumbnail or, until one exists, one of its part thumbnails, so this
// never calls Onshape.
export async function listShellRobots(): Promise<ShellRobot[]> {
  const [robotRows, systemRows, statusRows, partThumbs, reviewRows, sync, inventoryReviews] = await Promise.all([
    db.select().from(robots).orderBy(desc(robots.year), asc(robots.name)),
    db.select().from(systems).orderBy(asc(systems.name)),
    db
      .select({
        systemId: parts.systemId,
        classification: parts.classification,
        quantity: parts.quantity,
        designState: parts.designState,
        preProcess: parts.preProcess,
        process1: parts.process1,
        process2: parts.process2,
        donePreprocess: parts.donePreprocess,
        doneProcess1: parts.doneProcess1,
        doneProcess2: parts.doneProcess2,
      })
      .from(parts)
      .where(isNull(parts.removedFromCadAt)),
    db
      .selectDistinctOn([parts.systemId], { systemId: parts.systemId, id: parts.id, rev: parts.thumbnailRev })
      .from(parts)
      .where(and(isNotNull(parts.thumbnailRev), isNull(parts.removedFromCadAt)))
      .orderBy(parts.systemId, desc(parts.quantity), asc(parts.id)),
    db
      .select({ systemId: parts.systemId })
      .from(partReviews)
      .innerJoin(parts, eq(parts.id, partReviews.partId))
      .where(isNull(parts.removedFromCadAt)),
    listSystemSync(),
    // Inventory changes waiting in To Review count on every active robot (one shared shelf).
    countInventoryReviews(),
  ]);
  const partThumb = new Map(partThumbs.map((t) => [t.systemId, thumbKey(t.id, t.rev!)]));

  const shellSystems = await Promise.all(
    systemRows.map(async (s) => {
      const key = s.thumbnailPath ?? partThumb.get(s.id);
      const b = statusBreakdown(statusRows.filter((r) => r.systemId === s.id));
      return {
        robotId: s.robotId,
        id: s.id,
        name: s.name,
        assemblyUrl: s.assemblyUrl,
        percent: b.percent,
        total: b.total,
        thumbUrl: key ? await imageUrl(key) : null,
        sync: sync.get(s.id) ?? { outdated: null, waiting: 0 },
      };
    }),
  );

  return Promise.all(
    robotRows.map(async (r) => {
      const own = shellSystems.filter((s) => s.robotId === r.id);
      const ids = new Set(own.map((s) => s.id));
      const fab = { total: 0, byMachine: {} as Record<string, number> };
      for (const row of statusRows) {
        if (!ids.has(row.systemId!) || !fabStage(row)) continue;
        fab.total += 1;
        for (const m of machinesOf(row)) fab.byMachine[m] = (fab.byMachine[m] ?? 0) + 1;
      }
      return {
        fab,
        review: reviewRows.filter((x) => ids.has(x.systemId!)).length + (r.archived ? 0 : inventoryReviews),
        id: r.id,
        name: r.name,
        year: r.year,
        code: r.code,
        mainAssemblyUrl: r.mainAssemblyUrl,
        archived: r.archived,
        percent: statusBreakdown(statusRows.filter((x) => ids.has(x.systemId!))).percent,
        thumbUrl: r.thumbnailPath ? await imageUrl(r.thumbnailPath) : (own.find((s) => s.thumbUrl)?.thumbUrl ?? null),
        systems: own.map((s) => ({ id: s.id, name: s.name, assemblyUrl: s.assemblyUrl, percent: s.percent, total: s.total, thumbUrl: s.thumbUrl, sync: s.sync })),
      };
    }),
  );
}

// An inventory category as the left panel's group folders list it.
export type ShellCategory = { id: string; label: string; group: string };
