import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { listComments, reviewCounts } from "@/lib/data/cadReview";
import { listShellRobots } from "@/lib/data/shell";
import { robotModelBuiltAt } from "@/lib/model/build";
import { getMode, hasCapability } from "@/lib/mode";
import { canTick } from "@/lib/reviews/comments";
import { isUuid } from "@/lib/uuid";
import { OpenCommentsColumn, type CommentSection } from "./OpenCommentsColumn";
import { ReviewBoard } from "./ReviewBoard";

// CAD (plan/design-review.md; Harel, 2026-11-08 and 2026-11-09): the robot (the one picked in the
// right panel) in a wide 3D box on top, which opens the robot's CAD page, and below it every
// system: a 3D box on wide screens, its picture on phones. While the robot has open comments they
// sit in a column on the right, a section per system (the robot's own first). Reads the built 3D
// model only.
export default async function CadPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  const [robots, counts, builtAt, edit, comments] = await Promise.all([
    listShellRobots(),
    reviewCounts(robotId),
    robotModelBuiltAt(robotId),
    hasCapability("sync"),
    listComments({ robotId }),
  ]);
  const robot = robots.find((r) => r.id === robotId);
  if (!robot) notFound();
  const systems = robot.systems
    .filter((s) => s.assemblyUrl)
    .map((s) => ({ id: s.id, name: s.name, thumbUrl: s.thumbUrl, open: counts[s.id]?.open ?? 0, done: counts[s.id]?.done ?? 0 }));

  const open = comments.filter((c) => c.state === "open").reverse();
  const sections: CommentSection[] = [
    { id: null, name: "Robot", href: `/robots/${robotId}/cad-review/robot`, comments: open.filter((c) => !c.systemId) },
    ...robot.systems.map((s) => ({ id: s.id, name: s.name, href: `/robots/${robotId}/systems/${s.id}/cad-review`, comments: open.filter((c) => c.systemId === s.id) })),
  ].filter((s) => s.comments.length);

  const board = <ReviewBoard robotId={robotId} robotName={robot.name} robotCounts={counts.robot ?? { open: 0, done: 0 }} systems={systems} builtAt={builtAt} edit={edit} />;
  return (
    // The page's full width (no cap): with the side panels closed the robot gets wider and the
    // systems line up six to a row, with the page's normal margins (Harel, 2026-11-10).
    // No title: the previews start 25px under the top bar and end 25px above the bottom (the
    // page's 24px padding and 1px more) (Harel, 2026-11-10).
    <div className="py-px">
      <h1 className="sr-only">CAD</h1>
      {sections.length ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          {board}
          <OpenCommentsColumn sections={sections} me={{ id: member.id, isAdmin: member.isAdmin }} canTick={canTick(mode, member)} />
        </div>
      ) : (
        board
      )}
    </div>
  );
}
