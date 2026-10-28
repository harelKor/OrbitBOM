"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { dismissAction } from "@/app/(app)/actions-actions";
import { reapplyAction, revertAction, type ActionResult } from "@/app/(app)/undo-actions";
import { useEditMode } from "@/components/shell/ModeContext";
import { toast } from "@/components/ui/Toaster";
import { afterPartsUpdate } from "@/components/versions/afterUpdate";
import { useOpenVisit } from "@/components/shell/VisitTracker";
import { Popover } from "@/components/bom/Popover";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import type { RecentAction } from "@/lib/data/actions";
import { focusPart } from "./focusPart";

const TILE_REM = 6; // one thumbnail on a dashboard action box

// Each page visit in which someone changed parts, with the changed parts' thumbnails and how
// long ago it was. A box opens that page at the first part changed; X hides it for this member.
// System Updates (committed versions) are light blue and open the system's Versions. In Edit
// mode, Revert undoes an action (plan/system-versioning.md §8).
// "cards" (the dashboard, above All parts) sizes each box to its thumbnails; "list" (the
// system page, beside the 3D view) is a compact column of To Fab status changes, or, picked from
// the title's arrow when systemActions is given, of every change to the system's parts.
export function RecentActions({
  actions: fabActions,
  systemActions,
  max,
  variant = "cards",
  onOpen,
  title = true,
  itemNoun = ["part", "parts"],
}: {
  actions: RecentAction[];
  systemActions?: RecentAction[];
  max: number;
  variant?: "cards" | "list";
  onOpen?: (a: RecentAction) => void; // a box opens this instead of its page (Inventory: the item's window)
  title?: boolean;
  itemNoun?: [string, string];
}) {
  const [scope, setScope] = useState<"fab" | "system">("fab");
  const [shown, setShown] = useShown(variant);
  const all = scope === "system" && systemActions ? systemActions : fabActions;
  const now = useNow();
  // The visit still open on this page becomes an action once the member leaves.
  const open = useOpenVisit();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const actions = all.filter((a) => a.visitId !== open && !closed.has(a.visitId)).slice(0, max);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;

  const close = (visitId: string) => {
    setClosed((c) => new Set(c).add(visitId));
    void dismissAction(visitId);
  };
  const linkProps = (a: RecentAction) => ({
    href: `${a.page}#part-${a.firstPartId}`,
    // Next doesn't re-run anything for a link to the page already open, so focus here.
    onClick: () => {
      if (a.page === here) focusPart(a.firstPartId);
    },
  });

  if (variant === "list")
    return (
      <section className={`panel flex min-h-0 flex-col ${shown ? "flex-1" : ""}`}>
        <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          <Icon name={scope === "fab" ? "fab" : "box"} className="h-4 w-4 text-accent" />
          {systemActions ? (
            <Popover
              hideCaret
              triggerClassName="press flex items-center gap-1 rounded hover:text-accent"
              trigger={
                <>
                  Recent actions {scope === "fab" ? "in fab" : "in system"}
                  <Icon name="chevron" className="h-3.5 w-3.5 rotate-90 text-subtle" />
                </>
              }
            >
              {(close) => (
                <div className="space-y-0.5 text-sm">
                  {(["fab", "system"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setScope(s);
                        close();
                      }}
                      className={`flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-raised ${scope === s ? "font-semibold text-accent" : "text-fg"}`}
                    >
                      {s === "fab" ? "In fab" : "In system"}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          ) : (
            "Recent actions in fab"
          )}
          <button
            type="button"
            onClick={() => setShown(!shown)}
            aria-expanded={shown}
            aria-label={shown ? "Hide recent actions" : "Show recent actions"}
            className="press ml-auto"
          >
            <Chevron open={shown} small />
          </button>
        </h2>
        {!shown ? null : actions.length ? (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {actions.map((a) => (
              <li key={a.visitId} className="relative">
                <Link
                  {...linkProps(a)}
                  className={`card-interactive flex items-center gap-2 p-2 ${onOpen ? "pr-8" : "pr-16"} ${a.kind === "system" ? SYSTEM_BOX : ""}`}
                >
                  <span className="flex shrink-0 -space-x-3">
                    {a.thumbs.slice(0, 3).map((t) => (
                      <span key={t.id} className="thumb-well flex h-10 w-10 items-center justify-center rounded-md border border-line" title={t.name}>
                        {t.url && (
                          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                          <img src={t.url} alt={t.name} loading="lazy" className="max-h-full max-w-full object-contain" />
                        )}
                      </span>
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate">
                      <span className="font-bold">{a.memberName ?? "Someone"}</span>
                      {a.kind === "system" ? (
                        <span className="text-sky-600"> · System update {a.label}</span>
                      ) : a.statusTo ? (
                        <span className="text-muted"> → {a.statusTo}</span>
                      ) : (
                        scope === "system" && <span className="text-muted"> · {a.fields.join(", ")}</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-subtle">
                      <span className="font-mono tabular-nums">{a.partCount}</span> {a.partCount === 1 ? "part" : "parts"}
                    </span>
                  </span>
                  <TimePill at={a.at} now={now} />
                </Link>
                {!onOpen && <RevertButton a={a} className="top-1/2 right-8 -translate-y-1/2" />}
                <CloseButton onClick={() => close(a.visitId)} className="top-1/2 right-1.5 -translate-y-1/2" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex flex-1 items-center justify-center p-4 text-center text-sm text-subtle">
            {scope === "fab" ? "No status changes in To Fab this week." : "No changes in this system this week."}
          </p>
        )}
      </section>
    );

  if (!actions.length) return null;
  const Box = ({ a, className, children }: { a: RecentAction; className: string; children: React.ReactNode }) =>
    onOpen ? (
      <button type="button" onClick={() => onOpen(a)} className={className}>
        {children}
      </button>
    ) : (
      <Link {...linkProps(a)} className={className}>
        {children}
      </Link>
    );
  return (
    <section className="space-y-3">
      {title && (
        <h2 className="text-lg font-semibold">
          <button type="button" onClick={() => setShown(!shown)} aria-expanded={shown} className="press flex items-center gap-2 text-left">
            <Chevron open={shown} small />
            Recent actions
            <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-bold text-fg-2 tabular-nums">{actions.length}</span>
          </button>
        </h2>
      )}
      {(shown || !title) && (
        <ul className="flex flex-wrap gap-3">
          {actions.map((a) => {
            const extra = a.partCount - a.thumbs.length;
            // As wide as its thumbnails, but room for two so the text fits.
            const tiles = Math.max(a.thumbs.length, 2);
            return (
              <li key={a.visitId} className="relative max-w-full" style={{ width: `${tiles * TILE_REM}rem` }}>
                <Box a={a} className={`card-interactive group flex h-full w-full flex-col text-left ${a.kind === "system" ? SYSTEM_BOX : ""}`}>
                  <div
                    className="thumb-well relative grid h-24"
                    style={{
                      gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))`,
                    }}
                  >
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
                    <TimePill at={a.at} now={now} className="absolute top-2 left-2" />
                    {extra > 0 && (
                      <span className="absolute right-2 bottom-2 rounded-full bg-surface/90 px-1.5 py-0.5 font-mono text-[11px] text-fg-2 tabular-nums shadow-sm">
                        +{extra}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 space-y-0.5 p-3 text-sm">
                    <div className="truncate font-semibold">
                      {a.kind === "system" ? (
                        <>
                          <span className="text-sky-600">System update {a.label}</span> <span className="font-normal text-subtle">in</span> {a.pageName}
                        </>
                      ) : (
                        <>
                          {a.memberName ?? "Someone"} <span className="font-normal text-subtle">in</span> {a.pageName}
                        </>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {a.fields.join(", ")} <span className="text-subtle">·</span> <span className="font-mono tabular-nums">{a.partCount}</span>{" "}
                      {a.partCount === 1 ? itemNoun[0] : itemNoun[1]}
                    </div>
                  </div>
                </Box>
                {!onOpen && <RevertButton a={a} className="top-2 right-9" />}
                <CloseButton onClick={() => close(a.visitId)} className="top-2 right-2" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const SYSTEM_BOX = "border-sky-400/60 bg-sky-500/5 hover:border-sky-400";

// Revert on an action (Edit mode): a page visit's part edits go back (fields changed again since
// are left alone and listed), or a System Update's system goes back to the version before it.
function RevertButton({ a, className }: { a: RecentAction; className: string }) {
  const edit = useEditMode();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reverted, setReverted] = useReverted(a.visitId);
  if (!edit) return null;
  const done = (r: ActionResult, next: Reverted | null) => {
    if (r.error) return toast(r.error, true);
    toast(r.message ?? "Done.");
    setReverted(next);
    if (r.systemId) afterPartsUpdate(r.systemId, router);
  };
  const revert = () => {
    const what =
      a.kind === "system"
        ? `System update ${a.label} in ${a.pageName}: the system goes back to the version before it`
        : `${a.memberName ?? "This"} change in ${a.pageName}: ${a.fields.join(", ")} on ${a.partCount} ${a.partCount === 1 ? "part" : "parts"}`;
    if (!confirm(`Revert ${what}?`)) return;
    start(async () => {
      const r = await revertAction(a.kind ?? "edit", a.visitId);
      // A revert that changed nothing (everything edited again since) leaves nothing to redo.
      done(r, a.kind === "system" || r.batchId ? { batchId: r.batchId ?? null } : null);
    });
  };
  const reapply = () =>
    start(async () => {
      done(await reapplyAction(a.kind ?? "edit", a.visitId, reverted?.batchId ?? null), null);
    });
  return (
    <button
      type="button"
      onClick={reverted ? reapply : revert}
      disabled={pending}
      aria-label={reverted ? "Re-apply this action" : "Revert this action"}
      title={reverted ? "Reverted. Click to re-apply" : "Revert this action"}
      className={`press absolute flex h-6 w-6 items-center justify-center rounded-full border shadow-sm disabled:opacity-40 ${
        reverted ? "border-accent bg-accent text-white hover:bg-accent-hover" : "border-line bg-surface/90 text-subtle hover:border-accent hover:text-fg"
      } ${className}`}
    >
      <Icon name="undo" className={`h-3.5 w-3.5 transition-transform duration-200 ${reverted ? "-scale-x-100" : ""}`} />
    </button>
  );
}

// Which actions this browser reverted (and the revert's batch, which re-applying undoes), so the
// arrow stays flipped across reloads.
type Reverted = { batchId: string | null };
const REVERTED_KEY = "orbit-reverted-actions";
function useReverted(id: string) {
  const [value, set] = useState<Reverted | null>(null);
  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(REVERTED_KEY) ?? "{}") as Record<string, Reverted>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only memory
      set(all[id] ?? null);
    } catch {}
  }, [id]);
  const save = (next: Reverted | null) => {
    set(next);
    try {
      const all = JSON.parse(localStorage.getItem(REVERTED_KEY) ?? "{}") as Record<string, Reverted>;
      if (next) all[id] = next;
      else delete all[id];
      // Actions drop off after a week, so a few hundred entries at most.
      localStorage.setItem(REVERTED_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-300))));
    } catch {}
  };
  return [value, save] as const;
}

// Whether Recent actions is unfolded, remembered in this browser for each layout.
function useShown(variant: string) {
  const key = `orbit-recent-actions-${variant}`;
  const [shown, set] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
      if (localStorage.getItem(key) === "0") set(false);
    } catch {}
  }, [key]);
  const setShown = (v: boolean) => {
    set(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {}
  };
  return [shown, setShown] as const;
}

function TimePill({ at, now, className = "" }: { at: Date; now: number; className?: string }) {
  return (
    <span className={`shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold whitespace-nowrap text-white tabular-nums shadow-sm ${className}`}>
      {timeAgo(at, now)}
    </span>
  );
}

function CloseButton({ onClick, className }: { onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Clear this action"
      title="Clear"
      className={`press absolute flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface/90 text-subtle shadow-sm hover:border-accent hover:text-fg ${className}`}
    >
      <Icon name="close" className="h-3 w-3" />
    </button>
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
