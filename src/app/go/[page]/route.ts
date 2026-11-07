import { asc, desc } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";

// A robot's page by name, for the installed app's long-press shortcuts (src/app/manifest.ts): the
// manifest can't know a robot, so /go/fab opens Shop Fab of the robot last used, else the newest
// active one, as the home page picks it. A plain redirect, so it works before any page loads.
const PAGES = { fab: "fab", printing: "printing", factory: "factory", review: "review" } as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const sub = PAGES[page as keyof typeof PAGES];
  const to = (path: string) => NextResponse.redirect(new URL(path, publicOrigin(request)));
  if (!sub) return to("/");
  if (!(await getMember())) return to(`/login?next=${encodeURIComponent(`/go/${page}`)}`);
  const [robots, jar] = await Promise.all([
    db.select({ id: schema.robots.id, archived: schema.robots.archived }).from(schema.robots).orderBy(desc(schema.robots.year), asc(schema.robots.name)),
    cookies(),
  ]);
  const last = jar.get(ROBOT_COOKIE)?.value;
  const robot = robots.find((r) => r.id === last) ?? robots.find((r) => !r.archived);
  return to(robot ? `/robots/${robot.id}/${sub}` : "/robots/new");
}
