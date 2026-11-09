import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { loadRobotReview } from "@/lib/data/cadReview";
import { modelPartsOfRobot } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { getMode } from "@/lib/mode";
import { robotModelBuiltAt } from "@/lib/model/build";
import { canApprove, canTick } from "@/lib/reviews/comments";
import { isUuid } from "@/lib/uuid";
import { RobotReview } from "./RobotReview";

// The whole robot's CAD page (Harel, 2026-11-09): the system page's layout for the robot: its 3D
// model, the robot's own comments, each system's version tree, and every open comment of the
// robot. Reads the database only.
export default async function RobotReviewPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  const [data, review, parts, builtAt] = await Promise.all([getRobot(robotId), loadRobotReview(robotId), modelPartsOfRobot(robotId), robotModelBuiltAt(robotId)]);
  if (!data) notFound();
  return (
    <RobotReview
      robotId={robotId}
      robotName={data.robot.name}
      review={review}
      parts={parts}
      builtAt={builtAt}
      me={{ id: member.id, isAdmin: member.isAdmin, isMentor: member.isMentor }}
      canTick={canTick(mode, member)}
      canApprove={canApprove(mode, member)}
    />
  );
}
