import { notFound } from "next/navigation";
import { ReviewView } from "@/components/review/ReviewView";
import { requireMember } from "@/lib/auth";
import { listInventoryNames } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { listInventoryReviews } from "@/lib/review/inventory";
import { listRobotReviews } from "@/lib/review/review";
import { isUuid } from "@/lib/uuid";

// To Review: parts whose material, processes or type were set automatically, by Suggest setup
// or by a member's Claude, and suggested inventory links, waiting for their designer to approve
// or reject; and a Claude's edits to inventory items and new categories (shared by every robot).
export default async function ReviewPage({ params }: { params: Promise<{ robotId: string }> }) {
  await requireMember();
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  // All in one round: the robot's own read only decides the 404.
  const [data, parts, reviews, inventory, inventoryReviews] = await Promise.all([
    getRobot(robotId),
    listRobotParts(robotId),
    listRobotReviews(robotId),
    listInventoryNames(),
    listInventoryReviews(),
  ]);
  if (!data) notFound();
  const byPart = new Map(parts.map((p) => [p.id, p]));
  // An inventory link shows the item's name, not its id.
  const itemName = new Map(inventory.map((i) => [i.id, i.name]));
  const named = (changes: (typeof reviews)[number]["changes"]) => {
    const c = changes.inventoryItemId;
    if (!c) return changes;
    const name = (v: unknown) => (typeof v === "string" ? (itemName.get(v) ?? "removed item") : v);
    return { ...changes, inventoryItemId: { from: name(c.from), to: name(c.to) } };
  };
  const items = reviews.flatMap((r) => {
    const part = byPart.get(r.partId);
    if (!part) return [];
    // A change waiting for Approve shows like an applied one, from the part's value now.
    const waiting = Object.entries(r.pending).map(([f, to]) => [f, { from: (part as unknown as Record<string, unknown>)[f] ?? null, to }] as const);
    const changes = { ...r.changes, ...Object.fromEntries(waiting) };
    return [{ part, source: r.source, reason: r.reason, changes: named(changes), pending: Object.keys(r.pending), at: r.createdAt.toISOString(), batchId: r.batchId, memberName: r.memberName, aiName: r.aiName }];
  });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">AI review</h1>
      </div>
      <ReviewView robotId={data.robot.id} systems={data.systems.map((s) => ({ id: s.id, name: s.name }))} items={items} inventory={inventoryReviews} />
    </div>
  );
}
