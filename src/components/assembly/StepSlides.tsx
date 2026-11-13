"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { deleteAssemblyStep, nameAssemblySub, reorderAssemblySteps, tickAssemblyStep } from "@/app/(app)/robots/[robotId]/assembly/actions";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { LocalTime } from "@/components/ui/LocalTime";
import { toast } from "@/components/ui/Toaster";
import { subColor, type Place } from "@/lib/assembly/groups";
import { earlierKeys, stepKeys, stepRefsOf, subModel, wholeKeys, type Book } from "@/lib/assembly/view";
import type { AssemblyData, AssemblyStep } from "@/lib/data/assembly";
import { NEW_PART, OLD_PART } from "./colors";
import { Thumb } from "./PartSearch";
import { Progress } from "./Progress";
import { StepCanvas } from "./StepCanvas";
import { StepEditor, type EditorTarget } from "./StepEditor";

// A system's or sub-assembly's steps as slides down the page (Harel, 2026-11-10). Each has a done
// box; steps already done when the page opened sit in a folded Finished section on top, ones ticked
// now stay where they are. When the first step still to do is off screen, an arrow brings it back.
// Only the slide nearest the middle of the screen draws live 3D; the others show their still.
export function StepSlides({
  robotId,
  book,
  data,
  place,
  model,
  canEdit,
  canTick,
  onOpen,
  jump,
}: {
  robotId: string;
  book: Book;
  data: AssemblyData;
  place: Place;
  model: ViewerModel | null;
  canEdit: boolean;
  canTick: boolean;
  onOpen: (p: Place | null, stepId?: string) => void;
  jump: { key: string; n: number } | null; // a part tapped in the top 3D: go to its next step
}) {
  const list = book.steps(place);
  const sys = book.systems.find((s) => s.id === place.systemId)!;
  const title = place.sub ? book.subName(place.systemId, place.sub) : sys.name;

  // Ticks shown at once, before the server answers.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const isDone = (s: AssemblyStep) => {
    if (s.kind === "sub" && s.subRef && book.steps({ systemId: s.systemId, sub: s.subRef }).length) return book.done(s);
    return ticks[s.id] ?? !!s.tick;
  };
  // Done when the page opened: kept for the visit (the parent remounts this per place).
  const [finished] = useState(() => new Set(list.filter((s) => book.done(s)).map((s) => s.id)));
  const [showFinished, setShowFinished] = useState(false);
  const tick = async (s: AssemblyStep, done: boolean) => {
    setTicks((t) => ({ ...t, [s.id]: done }));
    const r = await tickAssemblyStep(robotId, s.id, done);
    if (r.error) {
      setTicks((t) => ({ ...t, [s.id]: !done }));
      toast(r.error, true);
    }
  };

  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const move = async (i: number, by: number) => {
    const ids = list.map((s) => s.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const r = await reorderAssemblySteps(robotId, place.systemId, place.sub, ids);
    // The action's reply already carries the page drawn again (it revalidates).
    if (r.error) toast(r.error, true);
  };
  const remove = async (s: AssemblyStep) => {
    if (!confirm(`Delete step "${s.title || "Sub-assembly"}"? This can't be undone.`)) return;
    const r = await deleteAssemblyStep(robotId, s.id);
    // The action's reply already carries the page drawn again (it revalidates).
    if (r.error) toast(r.error, true);
  };
  const rename = async () => {
    if (!place.sub) return;
    const name = prompt("Sub-assembly name (blank for the default):", title);
    if (name === null) return;
    const r = await nameAssemblySub(robotId, place.systemId, place.sub, name);
    // The action's reply already carries the page drawn again (it revalidates).
    if (r.error) toast(r.error, true);
  };

  // The slide nearest the middle of the screen gets the live 3D.
  const [active, setActive] = useState<string | null>(null);
  const slides = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    let frame = 0;
    const pick = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = window.innerHeight / 2;
        let best: { id: string; d: number } | null = null;
        for (const [id, el] of slides.current) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          const d = Math.abs((r.top + r.bottom) / 2 - mid);
          if (!best || d < best.d) best = { id, d };
        }
        setActive((a) => best?.id ?? a);
      });
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [list.length, showFinished]);

  // The first step still to do (after the last finished one), and whether it's off screen.
  const next = list.find((s) => !finished.has(s.id) && !isDone(s)) ?? null;
  const [away, setAway] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (!next) return;
    const check = () => {
      const el = slides.current.get(next.id);
      if (!el) return setAway(null);
      const r = el.getBoundingClientRect();
      // Down only once the reader has scrolled away (not for the next step just under the 3D).
      setAway(r.bottom < 80 ? "up" : r.top > window.innerHeight - 80 && window.scrollY > 200 ? "down" : null);
    };
    const first = requestAnimationFrame(check);
    window.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", check);
    };
  }, [next]);

  // A link to one step (#step-<id>, from a robot-level card): scrolled to once it's drawn.
  useEffect(() => {
    const id = location.hash.match(/^#step-([0-9a-f-]{36})$/)?.[1];
    if (!id) return;
    const t = setTimeout(() => {
      if (finished.has(id)) setShowFinished(true);
      setTimeout(() => slides.current.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    }, 0);
    return () => clearTimeout(t);
  }, [finished]);

  // The part's next step here: the first not done that has it, else the first that has it. A part
  // of a sub-assembly no step here uses opens that sub-assembly.
  const jumped = useRef(jump?.n ?? 0);
  useEffect(() => {
    if (!jump || jump.n === jumped.current) return;
    jumped.current = jump.n;
    const has = list.filter((s) => wholeKeys(book, s).includes(jump.key));
    const target = has.find((s) => !isDone(s)) ?? has[0];
    if (!target) {
      const sub = book.subOfKey.get(jump.key);
      if (!place.sub && sub && sub.systemId === place.systemId) return onOpen(sub);
      const name = data.parts.find((p) => p.key === jump.key)?.name ?? "That part";
      return toast(`${name} isn't in a step here yet.`);
    }
    const t = setTimeout(() => {
      if (finished.has(target.id)) setShowFinished(true);
      setActive(target.id);
      setTimeout(() => slides.current.get(target.id)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    }, 0);
    return () => clearTimeout(t);
  });

  const used = useMemo(() => new Set(list.flatMap((s) => stepKeys(book, s))), [list, book]);
  const done = list.filter(isDone).length;
  const slide = (s: AssemblyStep) => {
    const i = list.indexOf(s);
    return (
      <Slide
        key={s.id}
        ref={(el) => {
          if (el) slides.current.set(s.id, el);
          else slides.current.delete(s.id);
        }}
        n={i + 1}
        step={s}
        book={book}
        data={data}
        list={list}
        index={i}
        model={model}
        live={active === s.id}
        onLive={() => setActive(s.id)}
        done={isDone(s)}
        canTick={canTick && !(s.kind === "sub" && s.subRef && book.steps({ systemId: s.systemId, sub: s.subRef }).length)}
        onTick={(d) => tick(s, d)}
        onOpenSub={() => s.subRef && onOpen({ systemId: s.systemId, sub: s.subRef })}
        edit={
          editing
            ? {
                onEdit: () => setEditor({ kind: s.kind, step: s }),
                onUp: i > 0 ? () => move(i, -1) : undefined,
                onDown: i < list.length - 1 ? () => move(i, 1) : undefined,
                onDelete: () => remove(s),
                onInsert: () => setEditor({ kind: "step", before: s.id }),
              }
            : null
        }
      />
    );
  };
  const early = list.filter((s) => finished.has(s.id));
  const rest = list.filter((s) => !finished.has(s.id));

  return (
    <main className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        {place.sub && <span className="h-4 w-4 rounded" style={{ background: subColor(place.sub) }} />}
        <h1 className="display min-w-0 truncate text-2xl text-accent">{title}</h1>
        {place.sub && <span className="text-sm text-muted">in {sys.name}</span>}
        <Progress done={done} total={list.length} />
        <span className="flex-1" />
        {canEdit && editing && place.sub && (
          <button className="btn h-9 px-3 text-sm" onClick={rename}>
            Rename
          </button>
        )}
        {canEdit && (
          <button className={`h-9 px-3 text-sm ${editing ? "btn-primary" : "btn"}`} onClick={() => setEditing((e) => !e)}>
            <Icon name="pencil" className="h-4 w-4" /> {editing ? "Done editing" : "Edit steps"}
          </button>
        )}
      </header>

      {early.length > 0 && (
        <section className="rounded-lg border border-line bg-surface">
          <button className="press flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold pointer-coarse:min-h-11" onClick={() => setShowFinished((v) => !v)} aria-expanded={showFinished}>
            <span className="text-fg-2">{showFinished ? "▾" : "▸"}</span>
            Finished
            <span className="rounded-full bg-emerald-500/15 px-1.5 text-[0.6875rem] text-emerald-600 tabular-nums">{early.length}</span>
          </button>
          {showFinished && <div className="space-y-4 border-t border-line p-3">{early.map(slide)}</div>}
        </section>
      )}

      {rest.map(slide)}

      {!list.length && <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{canEdit ? "No steps yet. Edit steps to write the first one." : "No steps written here yet."}</p>}

      {editing && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary h-10 px-4" onClick={() => setEditor({ kind: "step" })}>
            + Step
          </button>
          {!place.sub && sys.subs.length > 0 && (
            <button className="btn h-10 px-4" onClick={() => setEditor({ kind: "sub" })}>
              + Sub-assembly step
            </button>
          )}
        </div>
      )}

      {editing && (
        <p className="text-xs text-subtle">
          {sys.subs.length > 0 && !place.sub ? "A sub-assembly step stands for a whole sub-assembly; its own steps are written on its page. " : ""}
          {countUnused(book, place, used)}
        </p>
      )}

      {editor && <StepEditor robotId={robotId} book={book} data={data} place={place} list={list} model={model} target={editor} onClose={() => setEditor(null)} />}

      {away && next && (
        <button
          onClick={() => slides.current.get(next.id)?.scrollIntoView({ block: "center", behavior: "smooth" })}
          className="btn-primary fixed right-4 bottom-4 z-30 h-11 animate-pop px-4 shadow-lg active:scale-[0.98]"
        >
          {away === "up" ? "↑" : "↓"} Back to step {list.indexOf(next) + 1}
        </button>
      )}
    </main>
  );
}

function countUnused(book: Book, place: Place, used: Set<string>) {
  const all = book.keys(place).filter((k) => place.sub || !book.subOfKey.has(k));
  const left = all.filter((k) => !used.has(k)).length;
  return left ? `${left} part${left === 1 ? "" : "s"} here aren't in a step yet (not every part needs one).` : "";
}

type SlideEdit = { onEdit: () => void; onUp?: () => void; onDown?: () => void; onDelete: () => void; onInsert: () => void };

function Slide({
  ref,
  n,
  step,
  book,
  data,
  list,
  index,
  model,
  live,
  onLive,
  done,
  canTick,
  onTick,
  onOpenSub,
  edit,
}: {
  ref: (el: HTMLElement | null) => void;
  n: number;
  step: AssemblyStep;
  book: Book;
  data: AssemblyData;
  list: AssemblyStep[];
  index: number;
  model: ViewerModel | null;
  live: boolean;
  onLive: () => void;
  done: boolean;
  canTick: boolean;
  onTick: (done: boolean) => void;
  onOpenSub: () => void;
  edit: SlideEdit | null;
}) {
  const sub = step.kind === "sub" ? step.subRef : null;
  const own = useMemo(() => stepKeys(book, step), [book, step]);
  // Earlier steps brought in whole: each in its own single colour (Harel, 2026-11-10).
  const refs = useMemo(() => stepRefsOf(book, list, step), [book, list, step]);
  const refKeys = useMemo(() => refs.flatMap((r) => r.keys), [refs]);
  const before = useMemo(() => earlierKeys(book, list, index).filter((k) => !own.includes(k) && !refKeys.includes(k)), [book, list, index, own, refKeys]);
  const shown = useMemo(() => (model ? subModel(model, [...before, ...refKeys, ...own], step.systemId) : null), [model, before, refKeys, own, step.systemId]);
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of before) m.set(k, OLD_PART);
    for (const r of refs) for (const k of r.keys) m.set(k, r.color);
    for (const k of own) m.set(k, sub ? subColor(sub) : NEW_PART);
    return m;
  }, [before, refs, own, sub]);
  const partByKey = useMemo(() => new Map(data.parts.map((p) => [p.key, p])), [data.parts]);
  const names = useMemo(() => new Map(data.parts.map((p) => [p.key, p.name])), [data.parts]);
  const ownParts = own.flatMap((k) => partByKey.get(k) ?? []);
  // A part tapped in the step's 3D opens its window (Harel, 2026-11-11).
  const openPart = useCallback(
    (key: string | null) => {
      const p = key ? partByKey.get(key) : undefined;
      if (p) void openPartWindow(p.id);
    },
    [partByKey],
  );
  const missing = step.kind === "step" && step.partKeys.some((k) => !partByKey.has(k));
  const label = sub ? step.title || book.subName(step.systemId, sub) : step.title;

  return (
    <>
      {edit && (
        <button onClick={edit.onInsert} className="press w-full rounded-md border border-dashed border-line py-1 text-xs font-semibold text-muted hover:bg-raised hover:text-fg pointer-coarse:min-h-9">
          + Step here
        </button>
      )}
      <article
        ref={ref}
        id={`step-${step.id}`}
        className={`scroll-mt-28 overflow-hidden rounded-lg border bg-surface ${step.critical ? "border-rose-500/70" : done ? "border-emerald-500/40" : "border-line"}`}
      >
        <header className={`flex items-center gap-3 border-b px-3 py-2 ${step.critical ? "border-rose-500/40 bg-rose-500/10" : "border-line"}`}>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${done ? "bg-emerald-500 text-white" : "bg-raised text-fg"}`}>{n}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">
              {sub && <Icon name="layers" className="mr-1.5 inline h-4 w-4 align-[-2px] text-fg-2" />}
              {label}
            </h2>
            {step.critical && <p className="text-xs font-bold text-rose-600">⚠ Critical step</p>}
            {missing && edit && <p className="text-xs font-semibold text-amber-600">CAD changed: some of its parts left the BOM. Edit it to check.</p>}
          </div>
          {edit ? (
            <div className="flex shrink-0 items-center gap-1">
              <button className="btn h-9 w-9 justify-center px-0" onClick={edit.onUp} disabled={!edit.onUp} aria-label="Move up">
                ↑
              </button>
              <button className="btn h-9 w-9 justify-center px-0" onClick={edit.onDown} disabled={!edit.onDown} aria-label="Move down">
                ↓
              </button>
              <button className="btn h-9 px-3 text-sm" onClick={edit.onEdit}>
                Edit
              </button>
              <button className="btn h-9 px-3 text-sm text-rose-600" onClick={edit.onDelete}>
                Delete
              </button>
            </div>
          ) : sub && !canTick ? (
            <Progress {...book.progress({ systemId: step.systemId, sub })} />
          ) : (
            <span className="flex shrink-0 flex-col items-end">
              <Checkbox checked={done} onChange={onTick} label="Done">
                <span className="font-semibold">Done</span>
              </Checkbox>
              {done && step.tick && (
                <span className="text-[0.6875rem] text-subtle">
                  {step.tick.by ?? "Someone"} · <LocalTime at={step.tick.at} />
                </span>
              )}
            </span>
          )}
        </header>
        {/* The 3D gets most of the width, the text a narrow column beside it (Harel, 2026-11-11).
            By the slide's own width: next to the branches it is narrow, so the text goes under. */}
        <div className="@container">
        <div className="grid @2xl:grid-cols-[minmax(0,1fr)_15rem] @4xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="relative aspect-[16/10] border-line bg-surface max-@2xl:border-b @2xl:border-r">
            {live && shown ? (
              <StepCanvas model={shown} colors={colors} camera={step.camera} names={names} cube={false} onPick={openPart} />
            ) : (
              <button onClick={onLive} className="absolute inset-0 flex items-center justify-center" aria-label="Show this step in 3D">
                {step.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={step.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                ) : (
                  <span className="text-sm text-muted">{model ? "Tap to show in 3D" : model === null ? "No 3D model yet" : "Loading the 3D view…"}</span>
                )}
                {step.imageUrl && model && <span className="absolute right-2 bottom-2 rounded bg-surface/90 px-2 py-0.5 text-[0.6875rem] font-semibold text-fg-2 shadow-sm">Tap for 3D</span>}
              </button>
            )}
          </div>
          <div className="space-y-3 p-3">
            {step.body && <p className="text-base leading-relaxed whitespace-pre-wrap text-fg">{step.body}</p>}
            {sub && (
              <button className="btn-primary h-10 px-4" onClick={onOpenSub}>
                Open {book.subName(step.systemId, sub)} →
              </button>
            )}
            {refs.length > 0 && (
              <div>
                <p className="label mb-1">Brings in</p>
                <ul className="space-y-1 text-[0.9375rem]">
                  {refs.map((r) => (
                    <li key={r.step.id}>
                      <a href={`#step-${r.step.id}`} className="press flex items-center gap-2 rounded px-1 py-0.5 hover:bg-raised pointer-coarse:min-h-9">
                        <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: r.color }} />
                        <span className="shrink-0 font-semibold tabular-nums">Step {r.n}</span>
                        <span className="min-w-0 flex-1 truncate text-fg-2">{r.step.title || "Sub-assembly"}</span>
                        <span className="shrink-0 text-xs text-subtle tabular-nums">{r.keys.length} part{r.keys.length === 1 ? "" : "s"}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!sub && ownParts.length > 0 && (
              <div>
                <p className="label mb-1">Parts in this step</p>
                <ul className="space-y-1 text-[0.9375rem]">
                  {ownParts.map((p) => (
                    <li key={p.key} className="flex items-center gap-2">
                      <Thumb url={p.thumbUrl} small />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.cots && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[0.625rem] font-bold text-amber-600">COTS</span>}
                      {p.number && <span className="shrink-0 font-mono text-[0.6875rem] text-subtle">{p.number}</span>}
                      <span className="shrink-0 text-xs text-fg-2 tabular-nums">×{p.qty}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        </div>
      </article>
    </>
  );
}
