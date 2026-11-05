import { notFound } from "next/navigation";
import { AreaBoxes } from "@/components/factory/AreaBoxes";
import { requireMember } from "@/lib/auth";
import { countArea } from "@/lib/data/factory";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// 3D Printing: one big box per team printer (Bambu, Markforged, H2D), like Factory Fab's
// (Harel, 2026-11-04).
export default async function PrintingPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  const [, data, printers] = await Promise.all([requireMember(), getRobot(robotId), countArea(robotId, "print")]);
  if (!data) notFound();
  return (
    <AreaBoxes
      robotName={data.robot.name}
      title="3D Printing"
      text="Parts printed on the team's printers, from released to on the shelf."
      base={`/robots/${robotId}/printing`}
      icon="printer"
      page={(id) => `print:${robotId}:${id}`}
      boxes={printers}
    />
  );
}
