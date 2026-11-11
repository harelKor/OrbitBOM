import Link from "next/link";

// The Onshape panel's big tiles (Harel, 2026-11-10).
export const TONES = {
  accent: "border-accent/50 bg-accent text-white hover:bg-accent-hover [&_.sub]:text-white/80 [&_.icon]:bg-white/15",
  amber: "text-fg border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 [&_.icon]:bg-amber-500/20 [&_.icon]:text-amber-500",
  sky: "text-fg border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 [&_.icon]:bg-sky-500/20 [&_.icon]:text-sky-500",
  violet: "text-fg border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 [&_.icon]:bg-violet-500/20 [&_.icon]:text-violet-500",
} as const;

export function Tile({ href, icon, title, sub, tone, badge = null, external = false }: { href: string; icon: string; title: string; sub: string; tone: keyof typeof TONES; badge?: number | null; external?: boolean }) {
  const cls = tileClass(tone);
  const body = <TileBody icon={icon} title={title} sub={sub} badge={badge} external={external} />;
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

export const tileClass = (tone: keyof typeof TONES) => `press relative flex min-h-24 w-full items-center gap-4 rounded-xl border-2 px-5 py-4 text-left shadow-sm transition-colors active:scale-[0.98] disabled:cursor-wait ${TONES[tone]}`;

export function TileBody({ icon, title, sub, badge = null, external = false, subClass = "" }: { icon: string; title: string; sub: string; badge?: number | null; external?: boolean; subClass?: string }) {
  return (
    <>
      <span className="icon flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-3xl" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-bold">
          {title}
          {external && <span className="ml-1.5 text-base opacity-60" aria-hidden>↗</span>}
        </span>
        <span className={`sub block text-sm text-muted ${subClass}`}>{sub}</span>
      </span>
      {badge !== null && <span className="absolute top-3 right-3 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white tabular-nums">{badge}</span>}
    </>
  );
}
