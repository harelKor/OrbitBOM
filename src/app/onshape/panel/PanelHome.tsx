import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";

const { reviewComments, robots, systems } = schema;

// The panel's first page on a linked assembly (Harel, 2026-11-09): Onshape stays the place to look
// at the CAD on a PC, the app keeps the comments. Update system and Comment stay in the panel;
// the BOM and the CAD page need more room, so they open in a new tab. A robot's main assembly
// has no Update system.
export async function PanelHome({ robotId, systemId, query }: { robotId: string; systemId: string | null; query: string }) {
  const [[robot], [system], [open]] = await Promise.all([
    db.select({ name: robots.name }).from(robots).where(eq(robots.id, robotId)),
    systemId ? db.select({ name: systems.name }).from(systems).where(eq(systems.id, systemId)) : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(reviewComments)
      .where(and(systemId ? eq(reviewComments.systemId, systemId) : and(eq(reviewComments.robotId, robotId), isNull(reviewComments.systemId)), eq(reviewComments.state, "open"))),
  ]);
  const base = systemId ? `/robots/${robotId}/systems/${systemId}` : `/robots/${robotId}`;
  const commentHref = `/onshape/panel/comments?${query}&${systemId ? `systemId=${systemId}` : `robotId=${robotId}`}`;
  const big = "flex h-12 w-full items-center justify-center gap-2 text-base active:scale-[0.98]";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted">{robot?.name ?? "Robot"}</p>
        <h1 className="text-lg font-semibold text-fg">{system?.name ?? "Whole robot"}</h1>
      </div>
      <div className="space-y-2">
        {systemId && (
          <Link href={`${base}?check=1`} className={`btn-primary ${big}`}>
            Update system
          </Link>
        )}
        <Link href={commentHref} className={`btn ${big}`}>
          Comment
          {(open?.n ?? 0) > 0 && <span className="rounded-full bg-amber-500/15 px-2 text-xs font-semibold text-amber-600 tabular-nums">{open!.n} open</span>}
        </Link>
        <a href={base} target="_blank" rel="noopener" className={`btn ${big}`}>
          View BOM <span aria-hidden>↗</span>
        </a>
        <a href={`${base}/cad-review`} target="_blank" rel="noopener" className={`btn ${big}`}>
          View CAD <span aria-hidden>↗</span>
        </a>
      </div>
    </div>
  );
}
