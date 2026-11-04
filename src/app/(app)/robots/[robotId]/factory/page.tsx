import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { FACTORY_FAB_MACHINES, packsByMaterial } from "@/config/machines";
import { requireMember } from "@/lib/auth";
import { autoPackByMaterial } from "@/lib/factory/autoPack";
import { countFactories } from "@/lib/data/factory";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// Factory Fab: one big box per partner factory (Zivudim, Beth El, ARAN, PCBway), like the COTS
// page's, with the parts waiting there (Harel, 2026-11-04).
export default async function FactoryFabPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  await requireMember();
  // Factories that pack by material (Zivudim) do it first, so their boxes count packs, not loose parts.
  await Promise.all(FACTORY_FAB_MACHINES.filter((m) => packsByMaterial(m.id)).map((m) => autoPackByMaterial(robotId, m.id)));
  const [data, factories] = await Promise.all([getRobot(robotId), countFactories(robotId)]);
  if (!data) notFound();
  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-h,2.75rem)-2rem)] flex-col gap-5 pb-4 md:min-h-[calc(100dvh-var(--topbar-h,2.75rem)-3rem)]">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">Factory Fab</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Parts made by our partner factories, from released to on the shelf.</p>
      </div>
      <div className="grid flex-1 auto-rows-fr gap-3 sm:grid-cols-2 sm:gap-5">
        {factories.map((f) => (
          <Link
            key={f.id}
            href={`/robots/${robotId}/factory/${f.id}`}
            className="card-interactive group relative flex min-h-36 flex-col justify-between p-5 active:scale-[0.98] sm:min-h-64 sm:p-9"
          >
            <span className="absolute top-4 right-4 grid h-11 w-11 place-items-center rounded-2xl border border-line bg-raised text-accent transition-colors group-hover:border-accent/40 sm:top-8 sm:right-8 sm:h-16 sm:w-16">
              <Icon name="factory" className="h-6 w-6 sm:h-9 sm:w-9" />
            </span>
            <span className="display font-mono text-5xl text-accent tabular-nums sm:text-8xl">{f.queue}</span>
            <span className="flex items-end gap-3">
              <span className="min-w-0 flex-1">
                {/* "3D Print - ARAN" reads as ARAN here, with 3D print in the line below. */}
                <span className="block truncate display text-3xl text-fg sm:text-5xl">{f.name.replace(/^3D Print - /, "")}</span>
                <span className="mt-0.5 block text-sm text-muted tabular-nums sm:text-lg">
                  {f.name.startsWith("3D Print") && "3D print · "}
                  {f.released} released · {f.packs} pack{f.packs === 1 ? "" : "s"}
                </span>
              </span>
              <Icon name="arrow" className="h-7 w-7 shrink-0 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
