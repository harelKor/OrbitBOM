"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OpenComment } from "@/components/review/Comments";
import { SnipMe } from "@/components/review/Snip";
import type { ReviewComment } from "@/lib/data/cadReview";

export type CommentSection = { id: string | null; name: string; href: string; comments: ReviewComment[] };

// The CAD page's right column while the robot has open comments (Harel, 2026-11-09): a section per
// system (the whole robot's first), each comment with its tick box; a tap on its text or part opens
// that system's CAD page.
export function OpenCommentsColumn({ sections, me, canTick }: { sections: CommentSection[]; me: { id: string; isAdmin: boolean }; canTick: boolean }) {
  const router = useRouter();
  const total = sections.reduce((n, s) => n + s.comments.length, 0);
  return (
    <SnipMe.Provider value={me.id}>
    <aside className="space-y-3 lg:sticky lg:top-[calc(var(--topbar-h,2.75rem)+1rem)] lg:max-h-[calc(100dvh-var(--topbar-h,2.75rem)-2rem)] lg:overflow-y-auto">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
        Open comments
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 tabular-nums">{total}</span>
      </h2>
      {sections.map((s) => (
        <Section key={s.id ?? "robot"} s={s}>
          {s.comments.map((c) => (
            <OpenComment key={c.id} c={c} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} onFocus={() => router.push(s.href)} />
          ))}
        </Section>
      ))}
    </aside>
    </SnipMe.Provider>
  );
}

// A system's (or the robot's) comments, folded away with a tap on its name; → opens its page.
function Section({ s, children }: { s: CommentSection; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className={`flex items-center ${open ? "border-b border-line" : ""}`}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-fg hover:bg-raised pointer-coarse:min-h-11">
          <span className={`text-xs text-subtle transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          <span className="rounded-full bg-amber-500/15 px-1.5 text-xs text-amber-600 tabular-nums">{s.comments.length}</span>
        </button>
        <Link href={s.href} className="press px-3 py-2 text-xs text-subtle hover:text-fg pointer-coarse:min-h-11" title={`Open ${s.name}`}>
          →
        </Link>
      </div>
      {open && <ul className="p-1">{children}</ul>}
    </section>
  );
}
