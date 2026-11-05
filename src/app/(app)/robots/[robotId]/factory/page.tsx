import { notFound } from "next/navigation";
import { AreaBoxes } from "@/components/factory/AreaBoxes";
import { FACTORY_FAB_MACHINES, packsByMaterial } from "@/config/machines";
import { requireMember } from "@/lib/auth";
import { autoPackByMaterial } from "@/lib/factory/autoPack";
import { countArea } from "@/lib/data/factory";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// Factory Fab: one big box per partner factory (Zivudim, Beth El, ARAN, PCBway).
export default async function FactoryFabPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  await requireMember();
  // Factories that pack by material (Zivudim) do it first, so their boxes count packs, not loose parts.
  await Promise.all(FACTORY_FAB_MACHINES.filter((m) => packsByMaterial(m.id)).map((m) => autoPackByMaterial(robotId, m.id)));
  const [data, factories] = await Promise.all([getRobot(robotId), countArea(robotId, "factory")]);
  if (!data) notFound();
  return (
    <AreaBoxes
      robotName={data.robot.name}
      title="Factory Fab"
      text="Parts made by our partner factories, from released to on the shelf."
      base={`/robots/${robotId}/factory`}
      icon="factory"
      page={(id) => `factory:${robotId}:${id}`}
      boxes={factories}
    />
  );
}
