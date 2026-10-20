import { cookies } from "next/headers";
import Link from "next/link";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { requireMember } from "@/lib/auth";
import { listRobots } from "@/lib/data/robots";

// The landing page: one tile per app. Robots are picked in the right sidebar.
export default async function HomePage() {
  await requireMember();
  const [robots, jar] = await Promise.all([listRobots(), cookies()]);
  const last = jar.get(ROBOT_COOKIE)?.value;
  const robot = robots.find((r) => r.id === last) ?? robots.find((r) => !r.archived);

  const tiles = [
    {
      href: robot ? `/robots/${robot.id}` : "/robots/new",
      title: "BOM",
      text: robot ? `${robot.name} · ${robot.breakdown.percent}% complete` : "Create the first robot",
    },
    { href: "/inventory", title: "Inventory", text: "Stock, locations and what each robot uses" },
  ];

  return (
    <div className="mx-auto max-w-4xl py-6">
      <h1 className="mb-6 display text-2xl text-accent">OrbitMech</h1>
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
