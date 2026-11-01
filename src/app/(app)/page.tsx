import { cookies } from "next/headers";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { FastLink } from "@/components/ui/FastLink";
import { requireMember } from "@/lib/auth";
import { listRobots } from "@/lib/data/robots";
import { landingPath } from "@/lib/teams";

// The landing page: one full-height picture card per app. Robots are picked in the right sidebar. Opening the app
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
      image: "/apps/bom.png",
    },
    { href: "/inventory", title: "Inventory", text: null, image: "/apps/inventory.png" },
    { href: "/cots", title: "COTS", text: null, image: "/apps/cots.png" },
  ];

  // The cards fill the space between the sidebars: the negative margins undo the shell's own
  // padding, and the area is exactly one screen tall under the top bar. Phones stack the three
  // cards as equal-height rows, so all of them fit without scrolling.
  return (
    <div className="-m-4 flex h-[calc(100dvh-var(--topbar-h,3.5rem))] overflow-hidden md:-m-6 lg:-ml-11 xl:-mr-11 px-5 py-3.5 md:px-6 md:py-5 lg:px-10 lg:py-7">
      <h1 className="sr-only">OrbitParts</h1>
      <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center md:max-w-[72rem]">
        {/* The team motto: one quiet line on desktop only, so it never pushes the cards down on phones. */}
        <p className="mb-3 hidden select-none text-center text-base font-semibold tracking-wide text-muted md:block lg:text-lg">
          Robots change · Spirit remains
        </p>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 md:grid md:max-h-[39rem] md:grid-cols-3 md:gap-6">
          {tiles.map((t) => (
            <FastLink
              key={t.title}
              href={t.href}
              className="group relative flex min-h-0 w-full flex-1 flex-col md:h-full md:min-h-[16rem] justify-end overflow-hidden rounded-3xl border-[4px] border-[#1a3bff]/55 bg-[#0d111c] shadow-[0_0_24px_-6px_rgba(0,24,230,0.35)] transition-all duration-300 hover:border-[#2952ff]/80 hover:shadow-[0_0_32px_-4px_rgba(26,59,255,0.55)] active:scale-[0.98]"
            >
              <Image
                src={t.image}
                alt=""
                fill
                loading="eager"
                sizes="(min-width: 768px) 33vw, 100vw"
                className="object-cover object-[center_20%] saturate-[0.92] contrast-[1.03] transition-transform duration-500 ease-out group-hover:scale-105"
              />
              {/* A light Orbit-blue tint and wash, so the three pictures share one colour atmosphere. */}
              <div className="pointer-events-none absolute inset-0 bg-[#0018e6]/16 mix-blend-color" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(0,34,255,0.14),transparent_70%)]" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#080a10]/95 via-[#080a10]/45 to-transparent" />
              <div className="relative z-10 m-2 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black/45 px-3.5 py-2.5 backdrop-blur-xl transition-colors duration-300 group-hover:bg-black/55 md:m-4 md:h-[7rem] md:gap-4 md:p-6">
                <div className="min-w-0">
                  <span className="display block text-xl text-[#2a4bff] drop-shadow-[0_0_10px_rgba(0,34,255,0.55)] transition-colors duration-300 group-hover:text-[#4a67ff] md:text-4xl">{t.title}</span>
                  {t.text && <span className="mt-0.5 line-clamp-1 block text-xs text-white/80 md:mt-1.5 md:text-sm">{t.text}</span>}
                </div>
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 md:size-9 place-items-center rounded-full border border-white/20 bg-white/10 text-white transition-transform duration-300 group-hover:translate-x-1"
                >
                  →
                </span>
              </div>
            </FastLink>
          ))}
        </div>
      </div>
    </div>
  );
}
