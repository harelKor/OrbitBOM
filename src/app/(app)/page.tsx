import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { requireMember } from "@/lib/auth";
import { listRobots } from "@/lib/data/robots";
import { landingPath } from "@/lib/teams";

// The landing page: one tile per app. Robots are picked in the right sidebar. Opening the app
// takes a member with a team to their page; the sidebar's Home link (?home) keeps the tiles.
export default async function HomePage({ searchParams }: { searchParams: Promise<{ home?: string }> }) {
  const member = await requireMember();
  const [robots, jar, { home }] = await Promise.all([listRobots(), cookies(), searchParams]);
  const last = jar.get(ROBOT_COOKIE)?.value;
  const robot = robots.find((r) => r.id === last) ?? robots.find((r) => !r.archived);
  if (home === undefined) {
    const path = await landingPath(member, robot?.id ?? null);
    if (path) redirect(path);
  }

  const tiles = [
    {
      href: robot ? `/robots/${robot.id}` : "/robots/new",
      title: "BOM",
      text: robot ? `${robot.name} · ${robot.breakdown.percent}% complete` : "Create the first robot",
    },
    { href: "/inventory", title: "Inventory", text: "Stock, locations and what each robot uses" },
    { href: "/cots", title: "COTS", text: "Released parts and the order list" },
  ];

  return (
    <div className="mx-auto max-w-4xl py-6">
      <h1 className="sr-only">OrbitParts</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.title}
            href={t.href}
            className="card-interactive group flex aspect-square flex-col justify-end p-5"
          >
            <span className="display text-3xl text-accent group-hover:text-fg">{t.title}</span>
            <span className="mt-1 text-sm text-muted">{t.text}</span>
          </Link>
        ))}
        <div className="flex aspect-square flex-col justify-end rounded-lg border border-dashed border-line p-5 text-faint">
          <span className="display text-3xl text-accent">More</span>
          <span className="mt-1 text-sm">Future apps</span>
        </div>
      </div>
    </div>
  );
}
