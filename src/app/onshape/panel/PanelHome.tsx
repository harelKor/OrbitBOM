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
  const n = open?.n ?? 0;
  // Big tiles that fill the panel's height (Harel, 2026-11-10): the panel is tall and narrow,
  // so they stack, and side by side once it's dragged wider.
  return (
    <div className="flex min-h-[calc(100dvh-2rem)] flex-col gap-3">
      <div>
        <p className="text-xs text-muted">{robot?.name ?? "Robot"}</p>
        <h1 className="text-xl font-bold text-fg">{system?.name ?? "Whole robot"}</h1>
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-3 min-[520px]:grid-cols-2">
        {systemId && <Tile href={`${base}?check=1`} icon="⟳" title="Update system" sub="Check Onshape for changes and commit them" tone="accent" />}
        <Tile href={commentHref} icon="💬" title="Comment" sub={n ? `${n} open comment${n === 1 ? "" : "s"}` : "Write a comment, snip the model"} tone="amber" badge={n || null} />
        <Tile href={base} icon="☰" title="View BOM" sub="Opens in a new tab" tone="sky" external />
        <Tile href={`${base}/cad-review`} icon="◈" title="View CAD" sub="Opens in a new tab" tone="violet" external />
      </div>
    </div>
  );
}

const TONES = {
  accent: "border-accent/50 bg-accent text-white hover:bg-accent-hover [&_.sub]:text-white/80 [&_.icon]:bg-white/15",
  amber: "text-fg border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 [&_.icon]:bg-amber-500/20 [&_.icon]:text-amber-500",
  sky: "text-fg border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 [&_.icon]:bg-sky-500/20 [&_.icon]:text-sky-500",
  violet: "text-fg border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 [&_.icon]:bg-violet-500/20 [&_.icon]:text-violet-500",
} as const;

function Tile({ href, icon, title, sub, tone, badge = null, external = false }: { href: string; icon: string; title: string; sub: string; tone: keyof typeof TONES; badge?: number | null; external?: boolean }) {
  const cls = `press relative flex min-h-24 items-center gap-4 rounded-xl border-2 px-5 py-4 text-left shadow-sm transition-colors active:scale-[0.98] ${TONES[tone]}`;
  const body = (
    <>
      <span className="icon flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-3xl" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-bold">
          {title}
          {external && <span className="ml-1.5 text-base opacity-60" aria-hidden>↗</span>}
        </span>
        <span className="sub block text-sm text-muted">{sub}</span>
      </span>
      {badge !== null && <span className="absolute top-3 right-3 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white tabular-nums">{badge}</span>}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}
