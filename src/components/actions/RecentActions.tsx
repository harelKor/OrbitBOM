"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOpenVisit } from "@/components/shell/VisitTracker";
import type { RecentAction } from "@/lib/data/actions";
import { focusPart } from "./focusPart";

// Above All parts on the robot dashboard: each page visit in which someone changed parts, as a
// box with the changed parts' thumbnails and how long ago it was. A box opens that page at the
// first part changed.
export function RecentActions({ actions: all, max }: { actions: RecentAction[]; max: number }) {
  const now = useNow();
  // The visit still open on this page becomes an action once the member leaves.
  const open = useOpenVisit();
  const actions = all.filter((a) => a.visitId !== open).slice(0, max);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  if (!actions.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Recent actions</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((a) => {
          const href = `${a.page}#part-${a.firstPartId}`;
          const extra = a.partCount - a.thumbs.length;
          return (
            <li key={a.visitId}>
              <Link
                href={href}
                // Next doesn't re-run anything for a link to the page already open, so focus here.
                onClick={() => {
                  if (a.page === here) focusPart(a.firstPartId);
                }}
                className="card-interactive group flex h-full flex-col"
              >
                <div className="thumb-well relative grid h-28 grid-cols-3 gap-px">
                  {a.thumbs.map((t) => (
                    <span key={t.id} className="flex items-center justify-center overflow-hidden" title={t.name}>
                      {t.url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                        <img src={t.url} alt={t.name} loading="lazy" className="max-h-full max-w-full object-contain p-1" />
                      ) : (
                        <span className="truncate px-1 text-[10px] text-subtle">{t.name}</span>
                      )}
                    </span>
                  ))}
                  <span className="absolute top-2 left-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white tabular-nums shadow-sm">
                    {timeAgo(a.at, now)}
                  </span>
                  {extra > 0 && (
                    <span className="absolute right-2 bottom-2 rounded-full bg-surface/90 px-1.5 py-0.5 font-mono text-[11px] text-fg-2 tabular-nums shadow-sm">
                      +{extra}
                    </span>
                  )}
                </div>
                <div className="min-w-0 space-y-0.5 p-3 text-sm">
                  <div className="truncate font-semibold">
                    {a.memberName ?? "Someone"} <span className="font-normal text-subtle">in</span> {a.pageName}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {a.fields.join(", ")} <span className="text-subtle">·</span>{" "}
                    <span className="font-mono tabular-nums">{a.partCount}</span> {a.partCount === 1 ? "part" : "parts"}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// "12s ago", "5m ago", "3h ago", "2d ago".
export function timeAgo(at: Date, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(at).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The current time, ticking every second so seconds count up live.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
