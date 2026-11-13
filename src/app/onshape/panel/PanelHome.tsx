import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { BasepartTile } from "./BasepartTile";
import { Tile } from "./tiles";
import { UpdateTile } from "./UpdateTile";

const { reviewComments, robots, systems } = schema;

// The panel's first page on a linked assembly (Harel, 2026-11-09): Onshape stays the place to look
// at the CAD on a PC, the app keeps the comments. Update system and Comment stay in the panel;
// the BOM and the CAD page need more room, so they open in a new tab. A robot's main assembly
// has no Update system. On a Basepart (Harel, 2026-11-12) there's no BOM to update: Update 3D view
// rebuilds the Basepart model, Geometry chooses its sketches, and comments and View CAD go on the
// Basepart model.
export async function PanelHome({ robotId, systemId, query, model }: { robotId: string; systemId: string | null; query: string; model: ModelKind }) {
  const [[robot], [system], [open]] = await Promise.all([
    db.select({ name: robots.name }).from(robots).where(eq(robots.id, robotId)),
    systemId ? db.select({ name: systems.name }).from(systems).where(eq(systems.id, systemId)) : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(reviewComments)
      .where(and(systemId ? eq(reviewComments.systemId, systemId) : and(eq(reviewComments.robotId, robotId), isNull(reviewComments.systemId)), inArray(reviewComments.state, ["open", "on_it"]))),
  ]);
  const basepart = model === "basepart";
  const base = systemId ? `/robots/${robotId}/systems/${systemId}` : `/robots/${robotId}`;
  const owner = systemId ? `systemId=${systemId}` : `robotId=${robotId}`;
  const commentHref = `/onshape/panel/comments?${query}&${owner}${basepart ? "&model=basepart" : ""}`;
  const cadHref = basepart ? `/robots/${robotId}/cad-review?${systemId ? `system=${systemId}&` : ""}model=basepart` : `${base}/cad-review`;
  const n = open?.n ?? 0;
  // Big tiles that fill the panel's height (Harel, 2026-11-10): the panel is tall and narrow,
  // so they stack, and side by side once it's dragged wider.
  return (
    <div className="flex min-h-[calc(100dvh-2rem)] flex-col gap-3">
      <div>
        <p className="text-xs text-muted">
          {robot?.name ?? "Robot"}
          {basepart ? " · Basepart" : ""}
        </p>
        <h1 className="text-xl font-bold text-fg">{system?.name ?? "Whole robot"}</h1>
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-3 min-[520px]:grid-cols-2">
        {!basepart && systemId && <UpdateTile systemId={systemId} />}
        {basepart && <BasepartTile robotId={robotId} />}
        <Tile href={commentHref} icon="💬" title="Comment" sub={n ? `${n} open comment${n === 1 ? "" : "s"}` : "Write a comment, snip the model"} tone="amber" badge={n || null} />
        {basepart && <Tile href={`/onshape/panel/geometry?${query}&${owner}`} icon="✎" title="Geometry" sub="Choose the sketches the 3D views show" tone="accent" />}
        {!basepart && <Tile href={base} icon="☰" title="View BOM" sub="Opens in a new tab" tone="sky" external />}
        <Tile href={cadHref} icon="◈" title="View CAD" sub="Opens in a new tab" tone="violet" external />
      </div>
    </div>
  );
}
