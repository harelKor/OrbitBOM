import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cleanView } from "@/components/viewer/viewState";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { CommentError } from "./comments";

const { namedViews, members } = schema;

// Onshape's Named views (S6, plan/cad-3d-viewer.md): a robot's saved 3D views, shared by the team.
// Anyone on the team saves one; its author or an admin deletes it. A name used again replaces
// that view, as Onshape asks to.
export type NamedView = { id: string; name: string; view: NonNullable<ReturnType<typeof cleanView>>; by: string | null; byId: string | null };

const MAX_NAME = 80;
const MAX_VIEWS = 200;

export async function listNamedViews(robotId: string): Promise<NamedView[]> {
  const rows = await db
    .select({ id: namedViews.id, name: namedViews.name, view: namedViews.view, byId: namedViews.createdBy, by: members.name })
    .from(namedViews)
    .leftJoin(members, eq(members.id, namedViews.createdBy))
    .where(eq(namedViews.robotId, robotId))
    .orderBy(asc(namedViews.name));
  return rows;
}

export async function saveNamedView(member: Member, robotId: string, name: string, view: unknown) {
  const n = name.trim().slice(0, MAX_NAME);
  if (!n) throw new CommentError("Name the view first.");
  const v = cleanView(view);
  if (!v) throw new CommentError("That view couldn't be read.");
  const [robot] = await db.select({ id: schema.robots.id }).from(schema.robots).where(eq(schema.robots.id, robotId));
  if (!robot) throw new CommentError("That robot is gone.");
  return db.transaction(async (tx) => {
    const [same] = await tx.select({ id: namedViews.id }).from(namedViews).where(and(eq(namedViews.robotId, robotId), eq(namedViews.name, n)));
    if (same) {
      await tx.update(namedViews).set({ view: v, createdBy: member.id, createdAt: new Date() }).where(eq(namedViews.id, same.id));
      return { id: same.id };
    }
    const count = (await tx.select({ id: namedViews.id }).from(namedViews).where(eq(namedViews.robotId, robotId))).length;
    if (count >= MAX_VIEWS) throw new CommentError(`A robot keeps up to ${MAX_VIEWS} named views; delete one first.`);
    const [row] = await tx.insert(namedViews).values({ robotId, name: n, view: v, createdBy: member.id }).returning({ id: namedViews.id });
    return row;
  });
}

export async function deleteNamedView(member: Member, id: string) {
  const [row] = await db.select().from(namedViews).where(eq(namedViews.id, id));
  if (!row) throw new CommentError("That view is gone.");
  if (!member.isAdmin && row.createdBy !== member.id) throw new CommentError("Only whoever saved it deletes a view.");
  await db.delete(namedViews).where(eq(namedViews.id, id));
  return row;
}
