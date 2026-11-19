"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { saveReviewSnip } from "@/app/(app)/review-comments-actions";
import { Dialog } from "@/components/Dialog";
import type { SnipStroke } from "@/db/schema";
import type { ReviewComment } from "@/lib/data/cadReview";
import { SNIP_COLORS } from "@/lib/reviews/snipStrokes";

// Snip (Harel, 2026-11-10): a rectangle cut from the 3D view, drawn on with a pen of any size and
// colour, an eraser and undo. Anyone draws on a comment's snip; its author erases any line, the
// others only their own, and they show as "Noa changed".

// The signed-in member, for whose lines are whose.
export const SnipMe = createContext<string | null>(null);

type Line = SnipStroke & { from?: number }; // `from`: its place in the saved snip
export type SnipDraft = { dataUrl: string; w: number; h: number; strokes: Omit<SnipStroke, "by">[] };

// Uploads a taken snip's picture; what addReviewComment stores with the comment.
export async function uploadSnip(snip: SnipDraft): Promise<{ snip: { path: string; w: number; h: number; strokes: SnipDraft["strokes"] } } | { error: string }> {
  const blob = await (await fetch(snip.dataUrl)).blob();
  const form = new FormData();
  form.append("file", blob, "snip.jpg");
  const res = await fetch("/api/review-snips", { method: "POST", body: form });
  const r = (await res.json().catch(() => ({ error: "The snip didn't upload." }))) as { path?: string; error?: string };
  if (!r.path) return { error: r.error ?? "The snip didn't upload." };
  return { snip: { path: r.path, w: snip.w, h: snip.h, strokes: snip.strokes } };
}

// Keeps a drag's pointer on the element; a pointer the browser has already let go of throws.
function capture(e: React.PointerEvent<Element>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {}
}

function pathOf(p: number[]) {
  let d = "";
  for (let i = 0; i + 1 < p.length; i += 2) d += `${i ? "L" : "M"}${p[i]} ${p[i + 1]}`;
  return p.length === 2 ? `${d}L${p[0] + 0.01} ${p[1]}` : d;
}

// The picture with its lines on top, scaled to the box it's in.
export function SnipPicture({ src, w, h, strokes, className = "" }: { src: string | null; w: number; h: number; strokes: Pick<SnipStroke, "c" | "s" | "p">[]; className?: string }) {
  return (
    <span className={`relative block overflow-hidden rounded bg-raised ${className}`} style={{ aspectRatio: `${w} / ${h}` }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 link or a local data URL
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      )}
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden>
        {strokes.map((s, i) => (
          <path key={i} d={pathOf(s.p)} stroke={s.c} strokeWidth={s.s} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </span>
  );
}

// Over the 3D view while snipping: drag a rectangle (finger or mouse); release takes it.
export function SnipOverlay({ onSnip, onCancel }: { onSnip: (r: { x: number; y: number; w: number; h: number }) => void; onCancel: () => void }) {
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const box = rect && { x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1), w: Math.abs(rect.x1 - rect.x0), h: Math.abs(rect.y1 - rect.y0) };
  return (
    <div
      className="absolute inset-0 z-40 cursor-crosshair touch-none bg-black/25"
      onPointerDown={(e) => {
        capture(e);
        const p = at(e);
        setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!rect) return;
        const p = at(e);
        setRect({ ...rect, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (box && box.w > 12 && box.h > 12) onSnip(box);
        setRect(null);
      }}
    >
      <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface/95 px-4 py-2 text-sm font-semibold text-fg shadow-md">
        Drag a rectangle to snip
      </div>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onCancel}
        className="press absolute top-3 right-3 h-10 rounded-md border border-line bg-surface/95 px-3 text-sm font-semibold text-fg shadow-sm active:scale-[0.98]"
      >
        Cancel
      </button>
      {box && <div className="pointer-events-none absolute border-2 border-white bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
    </div>
  );
}

// The drawing window. `mine(line)`: whether the member may erase it.
export function SnipEditor({
  title,
  src,
  w,
  h,
  initial,
  me,
  isAuthor,
  changed,
  saving,
  error,
  onConfirm,
  onClose,
}: {
  title: React.ReactNode;
  src: string | null;
  w: number;
  h: number;
  initial: Line[];
  me: string;
  isAuthor: boolean;
  changed?: { name: string }[];
  saving?: boolean;
  error?: string | null;
  onConfirm: (lines: Line[]) => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [history, setHistory] = useState<Line[][]>([]);
  const [color, setColor] = useState<string>(SNIP_COLORS[0]);
  const [size, setSize] = useState(4); // on screen, px
  const [erasing, setErasing] = useState(false);
  const [editing, setEditing] = useState(isAuthor);
  const [drawing, setDrawing] = useState<Line | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const canErase = (l: Line) => isAuthor || l.by === me;
  const toPicture = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * w) / r.width, y: ((e.clientY - r.top) * h) / r.height, scale: w / r.width };
  };
  const commit = (next: Line[]) => {
    setHistory((hst) => [...hst.slice(-49), lines]);
    setLines(next);
  };
  const eraseAt = (x: number, y: number, radius: number) => {
    const hit = (l: Line) => {
      const reach = radius + l.s / 2;
      for (let i = 0; i + 1 < l.p.length; i += 2) {
        const ax = l.p[i], ay = l.p[i + 1];
        const bx = l.p[i + 2] ?? ax, by = l.p[i + 3] ?? ay;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= reach) return true;
      }
      return false;
    };
    const next = lines.filter((l) => !(canErase(l) && hit(l)));
    if (next.length !== lines.length) commit(next);
  };
  const shown = drawing ? [...lines, drawing] : lines;
  const tool = "press flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-semibold text-fg-2 hover:bg-raised active:scale-[0.98]";
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width="w-[min(64rem,calc(100vw-1rem))]"
      compact
      actions={
        editing ? (
          // Undo beside Confirm in the title row, not a row of its own: the picture gets the room on
          // a phone (phone audit G10, Harel 2026-11-19).
          <>
            <button
              className="btn h-9 px-3 text-sm active:scale-[0.98]"
              disabled={!history.length}
              onClick={() => {
                setLines(history[history.length - 1]);
                setHistory((hst) => hst.slice(0, -1));
              }}
            >
              ↶ Undo
            </button>
            <button className="btn-primary h-9 px-4 text-sm active:scale-[0.98]" disabled={saving} onClick={() => onConfirm(lines)}>
              {saving ? "Saving…" : "Confirm"}
            </button>
          </>
        ) : (
          // Someone else's snip opens to look at; the pencil shows the drawing tools (Harel, 2026-11-10).
          <button className="btn h-9 px-3 text-sm active:scale-[0.98]" onClick={() => setEditing(true)} aria-label="Draw on it" title="Draw on it">
            ✏️ Draw
          </button>
        )
      }
    >
      <div className="space-y-3">
        {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-raised p-0.5" role="radiogroup" aria-label="Tool">
            <button role="radio" aria-checked={!erasing} className={`${tool} ${!erasing ? "bg-surface shadow-sm" : ""}`} onClick={() => setErasing(false)}>
              ✎ Pen
            </button>
            <button role="radio" aria-checked={erasing} className={`${tool} ${erasing ? "bg-surface shadow-sm" : ""}`} onClick={() => setErasing(true)}>
              ⌫ Eraser
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="max-sm:hidden">Size</span>
            <input type="range" min={1} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-[var(--color-accent)]" aria-label="Pen size" />
            <span className="flex h-6 w-10 items-center" aria-hidden>
              <span className="w-full rounded-full" style={{ height: size, background: erasing ? "var(--color-muted)" : color }} />
            </span>
          </label>
          <div className="flex flex-wrap gap-1 max-sm:gap-0.5" role="radiogroup" aria-label="Pen colour">
            {SNIP_COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => {
                  setColor(c);
                  setErasing(false);
                }}
                className={`press h-7 w-7 rounded-full border-2 active:scale-[0.95] pointer-coarse:h-9 pointer-coarse:w-9 ${color === c && !erasing ? "border-accent ring-2 ring-accent/40" : "border-line"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        )}
        {changed && changed.length > 0 && <p className="text-xs text-muted">{changed.map((c) => `${c.name} changed`).join(" · ")}</p>}
        <div className="relative mx-auto w-full overflow-hidden rounded border border-line bg-raised" style={{ aspectRatio: `${w} / ${h}`, maxHeight: "70dvh", maxWidth: `calc(70dvh * ${w / h})` }}>
          {src && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 link or a local data URL
            <img src={src} alt="" className="absolute inset-0 h-full w-full select-none" draggable={false} />
          )}
          <svg
            ref={svg}
            viewBox={`0 0 ${w} ${h}`}
            className={`absolute inset-0 h-full w-full touch-none ${editing ? "" : "pointer-events-none"} ${erasing ? "cursor-cell" : "cursor-crosshair"}`}
            onPointerDown={(e) => {
              capture(e);
              const { x, y, scale } = toPicture(e);
              if (erasing) return eraseAt(x, y, 8 * scale);
              setDrawing({ by: me, c: color, s: Math.max(1, Math.round(size * scale)), p: [x, y] });
            }}
            onPointerMove={(e) => {
              if (!e.buttons && e.pointerType === "mouse") return;
              const { x, y, scale } = toPicture(e);
              if (erasing) return e.buttons ? eraseAt(x, y, 8 * scale) : undefined;
              if (!drawing) return;
              const lx = drawing.p[drawing.p.length - 2], ly = drawing.p[drawing.p.length - 1];
              if (Math.hypot(x - lx, y - ly) < 1.5 * scale) return;
              setDrawing({ ...drawing, p: [...drawing.p, x, y] });
            }}
            onPointerUp={() => {
              if (drawing) commit([...lines, drawing]);
              setDrawing(null);
            }}
          >
            {shown.map((s, i) => (
              <path key={i} d={pathOf(s.p)} stroke={s.c} strokeWidth={s.s} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
        </div>
        {!isAuthor && lines.some((l) => l.by !== me) && <p className="text-xs text-subtle">You can erase your own lines; the others are the comment author&rsquo;s to erase.</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Dialog>
  );
}

// A comment's snip: its picture, a tap opens it to draw on (saved for everyone).
export function CommentSnip({ c, small = false }: { c: ReviewComment; small?: boolean }) {
  const me = useContext(SnipMe);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!c.snip) return null;
  const snip = c.snip;
  return (
    <>
      <button onClick={() => setOpen(true)} className={`press mt-1 block overflow-hidden rounded border border-line hover:border-accent/60 active:scale-[0.98] ${small ? "w-20" : "w-36"}`} title="Open the snip">
        <SnipPicture src={snip.url} w={snip.w} h={snip.h} strokes={snip.strokes} />
      </button>
      {snip.changed && snip.changed.length > 0 && <span className="block text-[0.6875rem] text-subtle">{snip.changed.map((x) => `${x.name} changed`).join(" · ")}</span>}
      {open && me && (
        <SnipEditor
          title={<span className="block truncate" title={c.body}>{c.body || "Snip"}</span>}
          src={snip.url}
          w={snip.w}
          h={snip.h}
          initial={snip.strokes.map((s, i) => ({ ...s, from: i }))}
          me={me}
          isAuthor={c.authorId === me}
          changed={snip.changed}
          saving={saving}
          error={error}
          onClose={() => setOpen(false)}
          onConfirm={(lines) =>
            start(async () => {
              setError(null);
              const own = lines.filter((l) => l.by === me).map(({ c: color, s, p }) => ({ c: color, s, p }));
              const keep = lines.filter((l) => l.by !== me && l.from !== undefined).map((l) => l.from!);
              const r = await saveReviewSnip(c.id, own, keep);
              if (r.error) return setError(r.error);
              setOpen(false);
              router.refresh();
            })
          }
        />
      )}
    </>
  );
}
