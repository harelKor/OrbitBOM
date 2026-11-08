import { asc, desc } from "drizzle-orm";
import { cookies } from "next/headers";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { FastLink } from "@/components/ui/FastLink";
import { LocalTime } from "@/components/ui/LocalTime";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { listReviews } from "@/lib/data/reviews";
import { hasCapability } from "@/lib/mode";
import { NewReview, type RobotOption } from "./NewReview";
import { StatusChip } from "./StatusChip";

// CAD Review (plan/design-review.md): designs the students sent for the mentors, newest activity
// first. Opening one never calls Onshape.
export default async function ReviewsPage() {
  const member = await requireMember();
  const [reviews, canSend, robotRows, systemRows, jar] = await Promise.all([
    listReviews(),
    hasCapability("sync"),
    db.select({ id: schema.robots.id, name: schema.robots.name, archived: schema.robots.archived }).from(schema.robots).orderBy(desc(schema.robots.year), asc(schema.robots.name)),
    db.select({ id: schema.systems.id, robotId: schema.systems.robotId, name: schema.systems.name, url: schema.systems.assemblyUrl }).from(schema.systems).orderBy(asc(schema.systems.name)),
    cookies(),
  ]);
  const robots: RobotOption[] = robotRows
    .filter((r) => !r.archived)
    .map((r) => ({ id: r.id, name: r.name, systems: systemRows.filter((s) => s.robotId === r.id).map((s) => ({ id: s.id, name: s.name, hasAssembly: !!s.url })) }));
  const last = jar.get(ROBOT_COOKIE)?.value;
  const open = reviews.filter((r) => r.status === "open");
  const done = reviews.filter((r) => r.status !== "open");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl text-accent">CAD Review</h1>
          <p className="mt-1 text-sm text-muted">Designs sent for the mentors, each as the exact Onshape state the student sent. Viewing costs no Onshape calls.</p>
        </div>
        {canSend &&
          (member.onshapeConnected ? (
            <NewReview robots={robots} defaultRobotId={robots.some((r) => r.id === last) ? last! : null} />
          ) : (
            <p className="text-sm text-muted">Connect Onshape on your profile to send a design.</p>
          ))}
      </div>
      {reviews.length ? (
        <>
          <ReviewList reviews={open} />
          {done.length > 0 && (
            <section className="space-y-2">
              <h2 className="label">Approved and closed</h2>
              <ReviewList reviews={done} />
            </section>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">No designs sent yet. A student sends one with + New review.</div>
      )}
    </div>
  );
}

function ReviewList({ reviews }: { reviews: Awaited<ReturnType<typeof listReviews>> }) {
  return (
    <ul className="space-y-2">
      {reviews.map((r) => {
        const latest = r.rounds.at(-1);
        return (
          <li key={r.id}>
            <FastLink href={`/reviews/${r.id}`} className="panel press flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:border-accent/50 active:scale-[0.98]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-fg">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {r.robot}
                  {r.system ? ` › ${r.system}` : ""}
                  {r.owner ? ` · ${r.owner}` : ""}
                </span>
              </span>
              <StatusChip status={r.status} />
              {latest && <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-fg-2 tabular-nums">Round {latest.seq}{latest.state === "building" ? " · exporting" : ""}</span>}
              <span className="text-xs text-subtle tabular-nums">
                <LocalTime at={r.activityAt} />
              </span>
            </FastLink>
          </li>
        );
      })}
    </ul>
  );
}
