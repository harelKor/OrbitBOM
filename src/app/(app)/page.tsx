import { cookies } from "next/headers";
import Image from "next/image";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { FastLink } from "@/components/ui/FastLink";
import { requireMember } from "@/lib/auth";
import { waitingOnYou } from "@/lib/data/cadReview";
import { listShellRobots } from "@/lib/data/shell";

// The landing page: one full-height picture card per app. Robots are picked in the right sidebar. Every team
// opens the app here, not on To Fab or a dashboard (Harel, 2026-11-07).
export default async function HomePage() {
  const member = await requireMember();
  // The robots and their completion come from the shell's read (the layout makes the same one in
  // this render, from the server's memory), not a read of their own.
  const [robots, jar] = await Promise.all([listShellRobots(), cookies()]);
  const last = jar.get(ROBOT_COOKIE)?.value;
  const robot = robots.find((r) => r.id === last) ?? robots.find((r) => !r.archived) ?? null;
  const waiting = await waitingOnYou(member, robot?.id ?? null);

  const tiles = [
    {
      href: robot ? `/robots/${robot.id}` : "/robots/new",
      title: "BOM",
      text: robot ? `${robot.name} · ${robot.percent}% complete` : "Create the first robot",
      image: "/apps/bom.png",
    },
    { href: "/inventory", title: "Inventory", text: null, image: "/apps/inventory.png" },
    { href: "/cots", title: "Orders", text: null, image: "/apps/cots.png" },
    // Harel's picture (2026-11-09): portrait, so the crop aims at the model on the screen.
    // The badge: comments waiting on you (a mentor: to approve; the CAD Team: open on your system).
    { href: robot ? `/robots/${robot.id}/cad-review` : "/robots/new", title: "CAD", text: waiting ? (member.isMentor ? `${waiting} to approve` : `${waiting} open on your system`) : null, image: "/apps/cad.webp", focus: "object-[center_30%]", badge: waiting },
  ];

  // The cards fill the space between the sidebars: the negative margins undo the shell's own
  // padding, and the area is exactly one screen tall under the top bar. Phones stack the four
  // cards as equal-height rows, so all of them fit without scrolling; wider screens show two by two.
  return (
    <div className="-m-4 flex h-[calc(100dvh-var(--topbar-h,2.75rem))] overflow-hidden md:-m-6 lg:-ml-11 xl:-mr-11 px-5 py-3.5 md:px-6 md:py-[25px] lg:px-10">
      <h1 className="sr-only">OrbitParts</h1>
      {/* On a PC: 25px from the top bar to the motto and from the cards to the screen's bottom; the cards fill the rest (Harel, 2026-11-09). */}
      <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center md:max-w-[72rem] md:justify-start">
        {/* The team motto: one quiet line on desktop only, so it never pushes the cards down on phones. */}
        <p className="mb-4 hidden select-none text-center text-lg leading-none font-semibold tracking-wide text-muted md:block lg:text-xl">
          Robots change · Spirit remains
        </p>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 md:grid md:grid-cols-2 md:gap-6">
          {tiles.map((t) => (
            <FastLink
              key={t.title}
              href={t.href}
              className="group relative flex min-h-0 w-full flex-1 flex-col md:h-full md:min-h-[16rem] justify-end overflow-hidden rounded-3xl border-[3px] border-accent/55 bg-surface shadow-[0_0_24px_-6px_color-mix(in_srgb,var(--color-accent)_35%,transparent)] transition-all duration-300 hover:border-accent-hover/80 hover:shadow-[0_0_32px_-4px_color-mix(in_srgb,var(--color-accent)_55%,transparent)] active:scale-[0.98]"
            >
              {t.image ? (
                <Image
                  src={t.image}
                  alt=""
                  fill
                  loading="eager"
                  sizes="(min-width: 768px) 50vw, 100vw"
                  className={`object-cover ${"focus" in t ? t.focus : "object-[center_20%]"} saturate-[0.92] contrast-[1.03] transition-transform duration-500 ease-out group-hover:scale-105`}
                />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--color-accent)_45%,transparent),transparent_65%)]" />
              )}
              {/* A light tint and wash in the accent colour (Orbit blue unless the colour slider moved), so the
                  three pictures share one colour atmosphere; the fade and dock follow the greyscale slider. */}
              <div className="pointer-events-none absolute inset-0 bg-bar/16 mix-blend-color" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,color-mix(in_srgb,var(--color-accent)_14%,transparent),transparent_70%)]" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/60 to-transparent" />
              <div className="relative z-10 m-2 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/80 px-3.5 py-2.5 backdrop-blur-xl transition-colors duration-300 group-hover:bg-surface/90 md:m-4 md:h-[7rem] md:gap-4 md:p-6">
                <div className="min-w-0">
                  <span className="display block text-xl text-accent drop-shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_40%,transparent)] transition-colors duration-300 group-hover:text-accent-hover md:text-4xl">{t.title}</span>
                  {t.text && <span className="mt-0.5 line-clamp-1 block text-xs text-muted md:mt-1.5 md:text-sm">{t.text}</span>}
                </div>
                {"badge" in t && !!t.badge && (
                  <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-sm font-bold text-white tabular-nums shadow" aria-label={`${t.badge} waiting on you`}>
                    {t.badge}
                  </span>
                )}
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 md:size-9 place-items-center rounded-full border border-accent/40 bg-accent/10 text-accent transition-transform duration-300 group-hover:translate-x-1"
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
