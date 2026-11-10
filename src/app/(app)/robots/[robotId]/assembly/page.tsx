import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { can } from "@/components/shell/mode";
import { db } from "@/db";
import { robots } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { loadAssembly } from "@/lib/data/assembly";
import { getMode } from "@/lib/mode";
import { robotModelBuiltAt } from "@/lib/model/build";
import { isUuid } from "@/lib/uuid";
import { Assembly } from "./Assembly";

// The Assembly page (plan/assembly-guides.md, Harel 2026-11-10): the robot in 3D coloured by
// sub-assembly, a column of steps per system, and each system's and sub-assembly's steps as
// slides that members tick off as they build. CAD writes the steps. Database only, no Onshape.
export default async function AssemblyPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  const [, mode] = await Promise.all([requireMember(), getMode()]);
  const [[robot], data, builtAt] = await Promise.all([
    db.select({ name: robots.name }).from(robots).where(eq(robots.id, robotId)),
    loadAssembly(robotId),
    robotModelBuiltAt(robotId),
  ]);
  if (!robot) notFound();
  return <Assembly robotId={robotId} robotName={robot.name} data={data} builtAt={builtAt} canEdit={can(mode, "instruct")} canTick={can(mode, "work")} />;
}
