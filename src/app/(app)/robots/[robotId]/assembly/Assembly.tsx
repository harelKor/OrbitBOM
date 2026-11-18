"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Branches } from "@/components/assembly/Branches";
import { LOOSE, OLD_PART } from "@/components/assembly/colors";
import { Progress } from "@/components/assembly/Progress";
import { StepCanvas } from "@/components/assembly/StepCanvas";
import { StepSlides } from "@/components/assembly/StepSlides";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import { parsePlace, placeKey, subColor, type Place } from "@/lib/assembly/groups";
import { makeBook, subModel, type Book } from "@/lib/assembly/view";
import type { AssemblyData, AssemblyStep } from "@/lib/data/assembly";

// The Assembly page (plan/assembly-guides.md, Harel 2026-11-10). Robot level: the robot in 3D
// coloured by sub-assembly (hover lights one up, a click opens it) over a column of steps per
// system. A system or sub-assembly opened (?at=<systemId>[:<code>]): its 3D on top, its steps as
// slides, and the branches on the right to jump anywhere.
export function Assembly({
  robotId,
  robotName,
  data,
  builtAt,
  canEdit,
  canTick,
  modelUrl = `/api/robots/${robotId}/model?model=bom`,
}: {
  robotId: string;
  robotName: string;
  data: AssemblyData;
  builtAt: string | null;
  canEdit: boolean;
  canTick: boolean;
  modelUrl?: string; // the /dev/assembly sandbox's made-up robot
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const book = useMemo(() => makeBook(data), [data]);
  const urlAt = useMemo(() => {
    const p = parsePlace(params.get("at"));
    const sys = p && book.systems.find((s) => s.id === p.systemId);
    return sys && (!p.sub || sys.subs.some((x) => x.code === p.sub)) ? p : null;
  }, [params, book]);
  // Set at once on a tap, then kept in step with the address (Back, links).
  const [at, setAt] = useState<Place | null>(urlAt);
  const [seen, setSeen] = useState(urlAt);
  if (seen !== urlAt) {
    setSeen(urlAt);
    setAt(urlAt);
  }
  const go = useCallback(
    (p: Place | null, stepId?: string) => {
      setAt(p);
      router.push(p ? `${pathname}?at=${placeKey(p)}${stepId ? `#step-${stepId}` : ""}` : pathname, { scroll: false });
      if (!stepId) window.scrollTo({ top: 0 });
    },
    [router, pathname],
  );

  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  useEffect(() => {
    if (!builtAt) return;
    let cancelled = false;
    fetch(modelUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { model: ViewerModel | null } | null) => !cancelled && setModel(d?.model ?? null))
      .catch(() => !cancelled && setModel(null));
    return () => {
      cancelled = true;
    };
  }, [modelUrl, builtAt]);

  const [branches, setBranches] = useState(false);
  // A part tapped in the top 3D of an opened system or sub-assembly: the slides go to its next step.
  const [jump, setJump] = useState<{ key: string; n: number } | null>(null);
  const sys = at && book.systems.find((s) => s.id === at.systemId);

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-4 p-3 sm:p-4">
      <TopView key={at ? placeKey(at) : "robot"} model={model} book={book} data={data} at={at} onOpen={go} onPart={(key) => setJump((j) => ({ key, n: (j?.n ?? 0) + 1 }))} />
      {!at || !sys ? (
        <Overview book={book} robotName={robotName} onOpen={go} canEdit={canEdit} />
      ) : (
        <>
          {/* Phones: where you are, and the branches behind a button. */}
          <div className="sticky top-[var(--topbar-h)] z-20 -mx-3 flex items-center gap-2 border-b border-line bg-bg/95 px-3 py-2 backdrop-blur lg:hidden">
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm whitespace-nowrap">
              <button className="press text-muted hover:text-fg pointer-coarse:min-h-9" onClick={() => go(null)}>
                {robotName}
              </button>
              <span className="text-subtle">›</span>
              <button className={`press pointer-coarse:min-h-9 ${at.sub ? "text-muted hover:text-fg" : "font-semibold text-fg"}`} onClick={() => go({ systemId: sys.id, sub: null })}>
                {sys.name}
              </button>
              {at.sub && (
                <>
                  <span className="text-subtle">›</span>
                  <span className="font-semibold text-fg">{book.subName(sys.id, at.sub)}</span>
                </>
              )}
            </nav>
            <button className="btn h-9 shrink-0 px-3 text-sm" onClick={() => setBranches(true)}>
              Branches
            </button>
          </div>
          <Dialog open={branches} onClose={() => setBranches(false)} title="Branches" sheet compact>
            <Branches
              book={book}
              robotName={robotName}
              at={at}
              onOpen={(p) => {
                setBranches(false);
                go(p);
              }}
            />
          </Dialog>
          <div className="gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_18.75rem]">
            <StepSlides key={placeKey(at)} robotId={robotId} book={book} data={data} place={at} model={model ?? null} canEdit={canEdit} canTick={canTick} onOpen={go} jump={jump} />
            <aside className="sticky top-[calc(var(--topbar-h)+1rem)] max-h-[calc(100vh-var(--topbar-h)-2rem)] self-start overflow-y-auto rounded-lg border border-line bg-surface p-3 max-lg:hidden">
              <Branches book={book} robotName={robotName} at={at} onOpen={go} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// The 3D on top: the robot (or the opened system) coloured by sub-assembly, or the opened
// sub-assembly in Onshape's colours. Hovering a part lights its whole sub-assembly; a click opens it.
function TopView({
  model,
  book,
  data,
  at,
  onOpen,
  onPart,
}: {
  model: ViewerModel | null | undefined;
  book: Book;
  data: AssemblyData;
  at: Place | null;
  onOpen: (p: Place) => void;
  onPart: (key: string) => void; // an opened system or sub-assembly: a part tapped, to find its step
}) {
  const [look, setLook] = useState<"assembly" | "cad">("assembly");
  const [hover, setHover] = useState<string | null>(null); // the hovered sub-assembly's place key
  const keys = useMemo(() => (at ? book.keys(at) : null), [at, book]);
  const shown = useMemo(() => (model && keys ? subModel(model, keys, at?.systemId) : model), [model, keys, at?.systemId]);
  const partByKey = useMemo(() => new Map(data.parts.map((p) => [p.key, p])), [data.parts]);
  const inSub = !!at?.sub;
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.parts) {
      const place = book.subOfKey.get(p.key);
      const k = place && placeKey(place);
      m.set(p.key, !place ? LOOSE : hover && k !== hover ? OLD_PART : subColor(place.sub!));
    }
    return m;
  }, [data.parts, book, hover]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.parts) {
      const place = book.subOfKey.get(p.key);
      m.set(p.key, place && !inSub ? `${book.subName(place.systemId, place.sub!)} · ${p.name}` : p.name);
    }
    return m;
  }, [data.parts, book, inSub]);
  const onHover = useCallback(
    (key: string | null) => {
      const place = key ? book.subOfKey.get(key) : undefined;
      setHover(place && !inSub ? placeKey(place) : null);
    },
    [book, inSub],
  );
  const onPick = useCallback(
    (key: string | null) => {
      if (!key) return;
      // Opened: the part's next step to do (Harel, 2026-11-11).
      if (at) return onPart(key);
      const place = book.subOfKey.get(key);
      if (place) return onOpen(place);
      const part = partByKey.get(key);
      if (part) onOpen({ systemId: part.systemId, sub: null });
    },
    [book, partByKey, at, onOpen, onPart],
  );
  const hovered = hover ? book.systems.flatMap((s) => s.subs.map((x) => ({ s, x }))).find(({ s, x }) => `${s.id}:${x.code}` === hover) : null;
  const mode = inSub || look === "cad" ? "cad" : "status";

  return (
    <section className="relative h-[42vh] min-h-72 overflow-hidden rounded-lg border border-line bg-surface lg:h-[48vh]">
      {shown ? (
        <StepCanvas model={shown} colors={colors} mode={mode} names={names} onPick={onPick} onHover={onHover} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          {shown === undefined ? "Loading the 3D view…" : "The 3D view shows here once the robot's 3D model is exported (Update 3D model on the robot page)."}
        </div>
      )}
      {!inSub && (
        <div className="absolute top-3 right-3 z-10 flex rounded-md border border-line bg-surface/95 p-0.5 text-xs font-semibold shadow-sm backdrop-blur">
          {(["assembly", "cad"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setLook(v)}
              className={`press rounded px-2.5 py-1 pointer-coarse:min-h-9 ${look === v ? "bg-accent text-white" : "text-fg-2 hover:bg-raised"}`}
            >
              {v === "assembly" ? "Assembly" : "CAD colours"}
            </button>
          ))}
        </div>
      )}
      {hovered && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-sm shadow-sm backdrop-blur">
          <span className="h-3 w-3 rounded-full" style={{ background: subColor(hovered.x.code) }} />
          <span className="font-semibold">{hovered.x.name}</span>
          <span className="text-muted">· {hovered.s.name} · {at ? "click for its step" : "click to open"}</span>
        </div>
      )}
    </section>
  );
}

// Robot level: one column per system, its steps in order; a sub-assembly step stands for the whole
// sub-assembly and opens it. Sub-assemblies no step places yet come last, dashed.
function Overview({ book, robotName, onOpen, canEdit }: { book: Book; robotName: string; onOpen: (p: Place | null, stepId?: string) => void; canEdit: boolean }) {
  if (!book.systems.length) return <p className="text-sm text-muted">{robotName} has no systems yet.</p>;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="display text-2xl text-accent">Assembly</h1>
        <p className="text-xs text-muted">{canEdit ? "Open a system to write its steps." : "Open a system or a sub-assembly to see its steps."}</p>
      </div>
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
        {book.systems.map((s) => {
          const place = { systemId: s.id, sub: null };
          const list = book.steps(place);
          const placed = new Set(list.flatMap((st) => (st.kind === "sub" && st.subRef ? [st.subRef] : [])));
          const loose = s.subs.filter((x) => !placed.has(x.code));
          const pr = book.progress(place);
          return (
            <div key={s.id} className="flex w-64 shrink-0 snap-start flex-col rounded-lg border border-line bg-surface">
              <button onClick={() => onOpen(place)} className="press flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-left hover:bg-raised">
                <span className="truncate font-semibold">{s.name}</span>
                <Progress {...pr} />
              </button>
              <ol className="flex-1 space-y-1.5 p-2">
                {list.map((st, i) => (
                  <li key={st.id}>
                    <StepCard book={book} step={st} n={i + 1} onClick={() => (st.kind === "sub" && st.subRef ? onOpen({ systemId: s.id, sub: st.subRef }) : onOpen(place, st.id))} />
                  </li>
                ))}
                {loose.map((x) => (
                  <li key={x.code}>
                    <button
                      onClick={() => onOpen({ systemId: s.id, sub: x.code })}
                      className="press flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-2 text-left text-sm text-fg-2 hover:bg-raised pointer-coarse:min-h-11"
                      title="This sub-assembly isn't placed in the system's steps yet"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: subColor(x.code) }} />
                      <span className="min-w-0 flex-1 truncate">{x.name}</span>
                      <Progress {...book.progress({ systemId: s.id, sub: x.code })} />
                    </button>
                  </li>
                ))}
                {!list.length && !loose.length && <li className="px-1 py-2 text-xs text-subtle">No steps yet.</li>}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StepCard({ book, step, n, onClick }: { book: Book; step: AssemblyStep; n: number; onClick: () => void }) {
  const done = book.done(step);
  const sub = step.kind === "sub" && step.subRef;
  return (
    <button
      onClick={onClick}
      className={`press flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm hover:bg-raised pointer-coarse:min-h-11 ${done ? "border-line text-muted" : "border-line text-fg"} ${step.critical ? "border-l-4 border-l-rose-500" : ""}`}
      style={sub ? { borderLeft: `4px solid ${subColor(sub)}` } : undefined}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold tabular-nums ${done ? "bg-emerald-500 text-white" : "bg-raised text-fg-2"}`}>{done ? "✓" : n}</span>
      {sub && <Icon name="layers" className="h-4 w-4 shrink-0 text-fg-2" />}
      <span className="min-w-0 flex-1 truncate">{sub ? step.title || book.subName(step.systemId, sub) : step.title}</span>
      {sub && <Progress {...book.progress({ systemId: step.systemId, sub })} />}
    </button>
  );
}

