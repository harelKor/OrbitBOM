"use client";

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { areaOfMachine, getMachine } from "@/config/machines";
import type { Priority } from "@/config/priorities";
import { STATUSES, statusLabel, type StatusName } from "@/config/statuses";
import { removeBatchGcode } from "@/app/(app)/files-actions";
import { deleteGroup, removeFromGroup, updateGroup } from "@/app/(app)/groups/actions";
import { upload } from "@/components/bom/FilesField";
import { OptionList, Popover } from "@/components/bom/Popover";
import { cadFormat } from "@/components/bom/PartCard";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { pickableStatuses } from "@/components/shell/mode";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusPill } from "@/components/ui/StatusPill";
import { READY_STATUS, isFabFinished } from "@/lib/fab";
import { type PartChanges } from "@/lib/parts/changes";
import { computeStatus, isDone } from "@/lib/status";
import { statusTint, tint } from "@/components/ui/statusTint";
import { downloadExport, prepareExport } from "@/components/bom/downloadExport";
import { BatchLayoutDialog } from "./BatchLayoutDialog";
import { OnshapeLayoutButton } from "./OnshapeLayoutButton";
import { FactoryStatusButton } from "@/components/factory/FactoryStatusButton";
import { type FabLayout, BATCH_PRIORITIES, priorityColor, rank, DRAG_TYPE, batchStage, FINISHED_COLOR, type Batch, type DragLoad } from "./fabModel";

// The collage's grid: one part fills it, two sit side by side, up to four in a 2×2, then 3×3.
export function collageGrid(count: number): React.CSSProperties {
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
}

// One open batch per section: opening a batch closes the one that was open.
export const OpenBatchContext = createContext<{ id: string | null; set: (id: string | null) => void } | null>(null);

// An open batch stays in its slot; its parts open in a strip the whole width of the section, in
// the grid row right under the batch's row (or beside it, below). So opening and closing never moves a card sideways or
// leaves a hole: only the rows below slide down and back (Harel, 2026-11-04). The strip's row is
// counted from the cards' tops (other batches' strips skipped) and placed explicitly, so the cards
// after the batch in its row stay beside it. Card and strip share one outline: the card's runs down
// a neck into the strip's, whose top edge is cut away under it, so it's plain which card the strip
// belongs to. A click anywhere off the two closes it.
// A batch that ends its row, with room beside it for all its parts, opens sideways instead: the
// strip fills the rest of its own row, joined to the card's right side (Harel, 2026-11-04).
const PANEL_MS = 220;
type Place = { row: number; column: string | null }; // column set: the strip sits beside the card
function placeOf(el: HTMLElement | null, parts: number): Place | null {
  const grid = el?.parentElement;
  if (!el || !grid) return null;
  const items = [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.batchPanel === undefined);
  const top = Math.round(el.offsetTop);
  const row = [...new Set(items.map((c) => Math.round(c.offsetTop)))].sort((a, b) => a - b).indexOf(top) + 1;
  const sameRow = items.filter((c) => Math.round(c.offsetTop) === top);
  // The columns as auto-fill makes them, from the grid's width and its smallest card. Not its
  // computed tracks: an open strip's own column adds a track there.
  const style = getComputedStyle(grid);
  const gap = parseFloat(style.columnGap) || 0;
  const min = grid.classList.contains("list-stack")
    ? 360
    : Math.max((parseFloat(style.getPropertyValue("--card-min")) || 220) * (parseFloat(style.getPropertyValue("--card-scale")) || 1), 110);
  const total = parseFloat(style.width) || grid.clientWidth;
  // A list's rows stretch to fill; cards are exactly `min` wide, or the full width when not even two fit.
  const list = grid.classList.contains("list-stack");
  const one = !list && total < 2 * min + gap;
  const cols = one ? 1 : Math.max(1, Math.floor((total + gap) / (min + gap)));
  const track = list ? (total - (cols - 1) * gap) / cols : one ? total : min;
  const col = sameRow.filter((c) => c.offsetLeft < el.offsetLeft).length;
  const free = cols - col - 1;
  const last = !sameRow.some((c) => c.offsetLeft > el.offsetLeft);
  // The strip's own grid (same column rule) must hold every part in one row: its width less the
  // strip's border and padding (2px and 12px a side).
  if (last && free > 0 && parts > 0 && parts * min + (parts - 1) * gap <= free * track + (free - 1) * gap - 28) return { row, column: `${col + 2} / -1` };
  return { row: row + 1, column: null };
}

// A fab batch: a collage of its parts, who makes it (on top of the collage; glowing when it's
// you) and, closed, the day it was made, its machine and material, one status for all of them
// (named as the machine calls it), download all (on a closed batch only until it has G-code) and
// its G-code. Clicking the card opens it in place, with each part's own status; cards dropped on
// it join it. Batches show no name: machine and material say which one it is (Harel,
// 2026-11-04). Delete is in Edit mode.
// `pack`: a Factory Fab pack, the same card without who makes it, machine and material, Auto
// Layout or G-code; its status is the big factory status button and its download is one zip of
// every part (Harel, 2026-11-04).
// `cart`: an Order List cart (with `pack`): its vendor as the title, its order status, its cart
// button in place of the downloads, its delivery date where a batch shows who makes it, and no
// priority, all opening the same way (Harel, 2026-11-05).
export type CartActions = { button: React.ReactNode; status: React.ReactNode; delivery: React.ReactNode; onDelete: () => void; onRemove: (partId: string) => void };
export function BatchCard({
  batch,
  members,
  save,
  card,
  layout = "cards",
  draggable,
  memberNames,
  me,
  onDropParts,
  pack = false,
  title,
  cart,
  arrival = false,
}: {
  batch: Batch;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart, inBatch?: { batch: Batch; members: CardPart[] }) => React.ReactNode;
  layout?: FabLayout;
  draggable: boolean;
  memberNames: string[];
  me: string;
  onDropParts?: (load: DragLoad) => void;
  pack?: boolean;
  title?: string; // a pack's name on the card (Zivudim's: its material)
  cart?: CartActions;
  arrival?: boolean; // holds a part this member hasn't seen arrive (src/lib/seen.ts): the card glows
}) {
  // Fab batches are Build Team work: any team renames, deletes and re-statuses them.
  const edit = useCan("work");
  // Setting one status for the whole batch: the CAD Team's statuses need a reason per part, so
  // they set those on each card; the Build Team picks from its own.
  const { mode } = useMode();
  const pickable = pickableStatuses(mode);
  const section = useContext(OpenBatchContext);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = section ? section.id === batch.id : ownOpen;
  const setOpen = (next: boolean) => (section ? section.set(next ? batch.id : null) : setOwnOpen(next));
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [madeBy, setMadeBy] = useState(batch.madeBy ?? "");
  const [, startTransition] = useTransition();
  const statuses = [...new Set(members.map((p) => computeStatus(p)))];
  const shared = statuses.length === 1 ? statuses[0] : null;
  const lowest = members.reduce((a, p) => (rank(p) < rank(a) ? p : a), members[0]);
  const [priority, setPriority] = useState(batch.priority);
  const stage = batchStage(members);
  // A finished batch drops its priority colour.
  const textColor = stage === "finished" ? undefined : priorityColor(priority);
  const materials = [...new Set(members.map((p) => p.material ?? ""))];
  const material = materials.length === 1 ? materials[0] || "No material" : "Mixed materials";
  const machineName = batch.machine ? (getMachine(batch.machine)?.name ?? batch.machine) : null;
  // What the batch is called in labels and questions, now that it shows no name.
  const what = cart ? `the ${title} cart` : pack ? (title ? `the ${title} pack` : "the pack") : `the ${[machineName, material].filter(Boolean).join(" ")} batch`;
  const downloads = members.flatMap((p) => {
    const f = cadFormat(p);
    return f ? [`/api/parts/${p.id}/export?format=${f}${p.fabView ? "&fab=1" : ""}`] : [];
  });
  // A laser batch (or one whose parts all cut from flat DXFs) downloads them as one zip.
  const dxfZip = batch.machine === "laser" || (members.length > 0 && members.every((p) => ["DXF", "DXF_FLAT"].includes(cadFormat(p) ?? "")));
  const notDone = members.filter((p) => !isDone(p));
  // The batch's status as its machine names it; a batch waiting to start is Ready to Fab.
  const label = (status: string) => (stage === "readyToFab" && status === READY_STATUS ? "Ready to Fab" : statusLabel(status, batch.machine));
  const statusOptions = STATUSES.filter((s) => !pickable || pickable.includes(s.name)).map((s) => ({ value: s.name, label: s.name === READY_STATUS ? "Ready to Fab" : statusLabel(s.name, batch.machine), color: s.color }));
  const thumbs = members.slice(0, 9);

  const mine = !pack && !!madeBy && madeBy === me;
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const list = layout === "list";
  const [place, setPlace] = useState<Place | null>(null);
  const side = !!place?.column;
  // Where the card sits by the strip (px, from the strip's top left), for the shared outline: over
  // it (`gap` between them) or, opened sideways, to its left (`gapX`).
  const [tab, setTab] = useState<{ left: number; width: number; gap: number; strip: number; top: number; height: number; gapX: number; stripHeight: number } | null>(null);
  const placeNow = () => setPlace((p) => {
    const next = placeOf(ref.current, members.length);
    return p && next && p.row === next.row && p.column === next.column ? p : next;
  });
  // The observer below keeps the part count it was made with, so it asks through an effect event.
  const relayout = useEffectEvent(placeNow);
  const toggle = () => {
    if (!open) placeNow();
    setOpen(!open);
  };
  // The strip stays mounted while it folds shut: `shown` drives its height (0fr / 1fr), `mounted`
  // whether it's there at all.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMounted(true);
    else setShown(false);
  }
  useEffect(() => {
    if (open && mounted && !shown) {
      // Two frames, so the folded strip is on screen before it unfolds.
      let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setShown(true))));
      return () => cancelAnimationFrame(frame);
    }
    if (!open && mounted) {
      const timer = setTimeout(() => setMounted(false), PANEL_MS);
      return () => clearTimeout(timer);
    }
  }, [open, mounted, shown]);
  // Cards around it can move (a filter, the window, another batch's strip): keep the strip's row
  // and the outline's neck in step. The List view is zoomed by the card size slider: rects come in
  // screen pixels, the strip's styles are in its own (zoomed) pixels, so they're divided back.
  useEffect(() => {
    const grid = ref.current?.parentElement;
    if (!mounted || !grid) return;
    const observer = new ResizeObserver(() => {
      relayout();
      const c = ref.current?.getBoundingClientRect();
      const s = panelRef.current?.getBoundingClientRect();
      if (!c || !s) return;
      const z = (panelRef.current as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
      const next = {
        left: (c.left - s.left) / z,
        width: c.width / z,
        gap: Math.max(s.top - c.bottom, 0) / z,
        strip: s.width / z,
        top: (c.top - s.top) / z,
        height: c.height / z,
        gapX: Math.max(s.left - c.right, 0) / z,
        stripHeight: s.height / z,
      };
      const same = (t: typeof next) => (Object.keys(next) as (keyof typeof next)[]).every((k) => Math.abs(t[k] - next[k]) < 0.25);
      setTab((t) => (t && same(t) ? t : next));
    });
    observer.observe(grid);
    if (ref.current) observer.observe(ref.current);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [mounted]);
  const closeOnOutside = useEffectEvent((e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    // A batch card's own click opens or closes it; windows and menus (Auto Layout, a part) and
    // controls that vanished with the click (a menu's option) aren't "outside".
    if (!t?.isConnected || ref.current?.contains(t) || panelRef.current?.contains(t) || t.closest("[data-batch-card], [role=dialog], dialog")) return;
    setOpen(false);
  });
  useEffect(() => {
    if (!open) return;
    document.addEventListener("click", closeOnOutside);
    return () => document.removeEventListener("click", closeOnOutside);
  }, [open]);
  const batchTint = stage === "finished" || isFabFinished(lowest) ? tint(FINISHED_COLOR) : statusTint(computeStatus(lowest));
  // The card's tint with its border colour given per side, so opening (which recolours some
  // sides) never mixes the shorthand with its parts.
  const { borderColor: tintBorder, ...tintFill } = batchTint ?? {};
  const cardTint: React.CSSProperties = tintBorder
    ? { ...tintFill, borderTopColor: tintBorder, borderRightColor: tintBorder, borderBottomColor: tintBorder, borderLeftColor: tintBorder }
    : tintFill;
  const userBox = (
    <select
      value={madeBy}
      disabled={!edit}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setMadeBy(e.target.value);
        startTransition(() => void updateGroup(batch.id, { madeBy: e.target.value || null }));
      }}
      aria-label={`Who makes ${what}`}
      title={mine ? "You make this batch" : undefined}
      className={`press max-w-full min-w-0 cursor-pointer truncate rounded-full border bg-surface/90 px-2 py-0.5 text-[11px] font-bold shadow-sm backdrop-blur-md transition-shadow hover:border-accent focus:outline-none ${
        mine ? "border-sky-400 text-sky-600 shadow-[0_0_10px_2px_rgba(56,189,248,0.55)] dark:text-sky-300" : "border-line-strong text-fg"
      }`}
    >
      <option value="">Nobody yet</option>
      {[...new Set([...(batch.madeBy ? [batch.madeBy] : []), ...memberNames])].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
  // Controls inside the card don't open or close it.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  // Cards from elsewhere dropped on the batch join it (a whole batch doesn't).
  const dropProps = onDropParts && {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const load = JSON.parse(raw) as DragLoad;
      if (!load.whole && load.batch !== batch.id && load.ids.length) onDropParts(load);
    },
  };

  const dragStart = (e: React.DragEvent) =>
    e.dataTransfer.setData(
      DRAG_TYPE,
      JSON.stringify({ ids: (notDone.length ? notDone : members).map((p) => p.id), from: stage, batch: batch.id, whole: true } satisfies DragLoad),
    );
  const statusMenu = cart ? cart.status : pack ? (
    <FactoryStatusButton
      status={shared}
      compact={list}
      area={areaOfMachine(batch.machine) ?? "factory"}
      machine={batch.machine ?? ""}
      count={members.length}
      onPick={(v) => save(members.map((p) => p.id), { status: v as StatusName })}
    />
  ) : (
    <Popover locked={!edit || mode === "cad"} trigger={<StatusPill status={shared ?? "Mixed"} label={shared ? label(shared) : undefined} size={list ? "sm" : "md"} />}>
      {(close) => (
        <OptionList
          options={statusOptions}
          value={shared}
          placeholder="Set status for all…"
          onPick={(v) => {
            if (v) save(members.map((p) => p.id), { status: v as StatusName });
            close();
          }}
        />
      )}
    </Popover>
  );
  const prioritySelect = (
    <select
      value={priority}
      disabled={!edit}
      onChange={(e) => {
        const next = e.target.value as Priority;
        setPriority(next);
        startTransition(() => void updateGroup(batch.id, { priority: next }));
      }}
      aria-label={`Priority of ${what}`}
      className="cursor-pointer rounded-full border border-line-strong bg-surface px-2 py-1 text-xs font-bold"
      style={textColor ? { color: textColor } : undefined}
    >
      <option value="normal">No priority</option>
      {BATCH_PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
  const autoLayoutButton = (
    <button
      className="press flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-bold text-fg-2 transition-colors duration-150 hover:border-sky-400/40 hover:text-sky-500 active:scale-[0.98]"
      onClick={() => setLayoutOpen(true)}
      title="Lay the parts flat and nest them on the smallest plate on the shelf"
    >
      <Icon name="layers" className="h-3.5 w-3.5" />
      Auto Layout
    </button>
  );
  const layoutDialog =
    layoutOpen &&
    createPortal(
      // The window sits outside the card in the page, but React still hands its clicks to the card.
      <div onClick={stop} onDoubleClick={stop}>
        <BatchLayoutDialog groupId={batch.id} name={[machineName, material].filter(Boolean).join(" · ")} machine={batch.machine} open onClose={() => setLayoutOpen(false)} />
      </div>,
      document.body,
    );
  // A factory's pack downloads as one zip; a printer's as each part's own file, nothing to unzip
  // (Harel, 2026-11-04).
  const downloadButtons = cart ? (
    cart.button
  ) : pack && areaOfMachine(batch.machine) === "print" ? (
    downloads.length > 0 && (
      <button className="overlay-btn" onClick={() => void downloadAll(downloads)} aria-label={`Download ${what}'s ${downloads.length} files`} title={`Download ${downloads.length} files`}>
        <Icon name="download" />
      </button>
    )
  ) : pack ? (
    downloads.length > 0 && (
      <button
        className="overlay-btn"
        onClick={() => void downloadExport(`/api/groups/${batch.id}/zip`)}
        aria-label={`Download ${what}'s ${members.length} parts as a zip`}
        title={`All ${members.length} parts in one zip, named with each part's quantity`}
      >
        <Icon name="download" />
      </button>
    )
  ) : (
    <>
      {downloads.length > 0 && !(batch.gcode && !open) && (
        <button className="overlay-btn" onClick={() => void downloadAll(downloads)} aria-label={`Download ${downloads.length} files`} title={`Download ${downloads.length} files`}>
          <Icon name="download" />
        </button>
      )}
      {/* A laser batch's whole sheet, laid out as in Auto Layout, in one DXF. */}
      {batch.machine === "laser" && (
        <button
          className="overlay-btn w-auto gap-1 px-2 text-xs font-semibold"
          onClick={() => void downloadExport(`/api/groups/${batch.id}/layout-dxf`)}
          aria-label={`Download ${what}'s sheet layout as one DXF`}
          title="The whole sheet as one DXF: every copy where Auto Layout put it"
        >
          <Icon name="download" />
          Layout DXF
        </button>
      )}
      {dxfZip && downloads.length > 0 && (
        <button
          className="overlay-btn w-auto gap-1 px-2 text-xs font-semibold"
          onClick={() => void downloadExport(`/api/groups/${batch.id}/dxf`)}
          aria-label={`Download ${what}'s flat DXFs as a zip`}
          title="All flat DXFs in one zip, named with each part's quantity"
        >
          <Icon name="download" />
          DXF zip
        </button>
      )}
      {!open && batch.gcode && (
        <a className="overlay-btn" href={`/api/files/${batch.gcode.id}?download=1`} aria-label={`Download G-code ${batch.gcode.filename}`} title={`G-code: ${batch.gcode.filename}`}>
          <Icon name="gcode" />
        </a>
      )}
    </>
  );
  const deleteButton = (
    <button
      className="press shrink-0 text-xs text-subtle hover:text-rose-700"
      onClick={() => {
        if (cart) {
          if (confirm(`Delete ${what}? Its parts stay on the Order List.`)) cart.onDelete();
        } else if (confirm(`Delete ${what}? Its parts stay on the BOM with their status.`)) startTransition(() => void deleteGroup(batch.id));
      }}
    >
      {cart ? "Delete cart" : pack ? "Delete pack" : "Delete fab"}
    </button>
  );
  const removeButton = (p: CardPart) =>
    edit && (
      <button className="self-start text-xs text-subtle hover:text-rose-700" onClick={() => (cart ? cart.onRemove(p.id) : startTransition(() => void removeFromGroup(batch.id, p.id)))}>
        {cart ? "Remove from cart" : pack ? "Remove from pack" : "Remove from batch"}
      </button>
    );

  // The strip under the batch's row: its actions, then its parts (cards, or rows in the List view).
  const radius = list ? 16 : 12; // the card's corners (rounded-2xl rows, rounded-xl cards)
  const joined = open && tab;
  // Your own batch, open: the whole shape (card, neck, strip) takes the sky outline and glow, not
  // just the card, so the glow isn't cut off at the join (Harel, 2026-11-04). Each piece's glow is
  // clipped where it meets the next.
  const edge = mine ? "rgb(56 189 248)" : "var(--color-accent)";
  const glow = "0 0 22px 4px rgba(56,189,248,0.4)";
  // The open card's outline, open on the side the strip is on. Each side on its own: React warns
  // when a shorthand and its parts swap on rerender.
  const openEdges = {
    borderTopColor: edge,
    borderLeftColor: edge,
    borderRightColor: side ? "transparent" : edge,
    borderBottomColor: side ? edge : "transparent",
  };
  const topRadii = !joined
    ? { tl: radius, tr: radius }
    : side
      ? { tl: 0, tr: radius }
      : { tl: tab.left < radius ? 0 : radius, tr: tab.left + tab.width > tab.strip - radius ? 0 : radius };
  // Sideways, a strip no taller than the card meets it with a square bottom corner too.
  const bottomLeft = joined && side && tab.stripHeight < tab.top + tab.height + radius ? 0 : radius;
  const panel = mounted && (
    <div
      ref={panelRef}
      data-batch-panel=""
      onClick={stop}
      style={{
        gridColumn: place?.column ?? "1 / -1",
        gridRow: place?.row,
        // Below the card it unfolds downwards; beside it, it slides out of the card to the right and
        // folds back into it, at full height (Harel, 2026-11-07). The clip leaves room for the glow
        // and the neck on its left.
        ...(side
          ? { gridTemplateRows: "1fr", clipPath: shown ? "inset(-40px -40px -40px -40px)" : "inset(-40px 100% -40px -40px)" }
          : { gridTemplateRows: shown ? "1fr" : "0fr", ...(!shown && { marginBottom: 0 }) }),
      }}
      className="relative grid cursor-default transition-[grid-template-rows,margin-bottom,clip-path] duration-200 ease-out motion-reduce:transition-none"
    >
      {/* The strip's glow, outside its clipped fold. */}
      {joined && mine && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: glow, borderRadius: `${topRadii.tl}px ${topRadii.tr}px ${radius}px ${bottomLeft}px` }}
        />
      )}
      {/* The neck: the card's sides carried down across a gap left to the strip. The open card
          reaches down to the strip itself (`reach`), so normally there's none and no seam shows.
          Sideways, it carries the card's top and bottom across the column gap. */}
      {joined && side && tab.gapX > 0.5 && (
        <span
          aria-hidden
          className="pointer-events-none absolute border-y-2 bg-surface"
          style={{
            left: -tab.gapX,
            width: tab.gapX + 2,
            top: tab.top,
            height: tab.height,
            backgroundColor: batchTint?.backgroundColor,
            borderColor: edge,
            ...(mine && { boxShadow: glow, clipPath: "inset(-40px 0)" }),
          }}
        />
      )}
      {joined && !side && tab.gap > 0.5 && (
        <span
          aria-hidden
          className="pointer-events-none absolute border-x-2 bg-surface"
          style={{
            left: tab.left,
            width: tab.width,
            top: -tab.gap,
            height: tab.gap + 2,
            backgroundColor: batchTint?.backgroundColor,
            borderColor: edge,
            ...(mine && { boxShadow: glow, clipPath: "inset(0 -40px)" }),
          }}
        />
      )}
      <div className="min-h-0 overflow-hidden">
        <div
          style={{
            ...batchTint,
            // Each corner on its own: React warns when a shorthand and its parts swap on rerender.
            borderTopLeftRadius: topRadii.tl,
            borderTopRightRadius: topRadii.tr,
            borderBottomLeftRadius: bottomLeft,
            borderBottomRightRadius: radius,
            ...(joined && {
              borderColor: edge,
              // The top edge is cut where the neck comes in (sideways, the left edge beside the
              // card); a corner under the card goes square.
              maskImage: "linear-gradient(#000 0 0), linear-gradient(#000 0 0)",
              maskSize: side ? `100% 100%, 2px ${Math.max(tab.height - 4, 0)}px` : `100% 100%, ${tab.width - 4}px 2px`,
              maskPosition: side ? `0 0, 0 ${tab.top + 2}px` : `0 0, ${tab.left + 2}px 0`,
              maskRepeat: "no-repeat",
              maskComposite: "exclude",
            }),
          }}
          className="space-y-3 border-2 border-accent/60 bg-surface p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            {(!pack || title) && (
              <span className={`min-w-0 truncate text-sm font-semibold ${textColor ? "" : "text-fg"}`} style={textColor ? { color: textColor } : undefined}>
                {pack ? title : material}
                {!pack && machineName && ` · ${machineName}`}
              </span>
            )}
            {!cart && prioritySelect}
            {!pack && (
              <>
                {autoLayoutButton}
                <OnshapeLayoutButton groupId={batch.id} url={batch.onshapeLayoutUrl} where="card" />
                <GcodeRow batch={batch} />
              </>
            )}
            {edit && <span className="ml-auto">{deleteButton}</span>}
          </div>
          <div className={list ? "list-stack" : "card-grid"} style={list ? { zoom: 1 } : undefined}>
            {/* A part is never wider than the batch's own card, even when one column fills the strip. */}
            {members.map((p) => (
              <div key={p.id} className="flex min-w-0 flex-col gap-1" style={!list && tab ? { maxWidth: tab.width } : undefined}>
                {card(p, { batch, members })}
                {removeButton(p)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (list) {
    // The List view: one row (collage, material · machine, the day it was made, who makes it,
    // status, downloads, chevron); a click opens the strip below it. A batch's row has a heavier
    // outline than a part's, so the two don't run together in the list.
    const small = members.slice(0, 4);
    return (
      <>
      <div ref={ref} data-batch-card="" {...dropProps} draggable={draggable} onDragStart={dragStart} className="min-w-0" style={open ? { marginBottom: 0 } : undefined}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && toggle()}
          style={{
            ...cardTint,
            ...(mine && { boxShadow: "0 0 0 2px rgba(56,189,248,0.75), 0 0 18px 3px rgba(56,189,248,0.35)" }),
            // Open, the row reaches down to its strip (the grid's gap is its own padding), so card
            // and strip meet with no seam (Harel, 2026-11-04).
            ...(open && !side && { ...openEdges, paddingBottom: "calc(0.625rem + var(--fab-gap))", clipPath: "inset(-40px -40px 0 -40px)" }),
            // Sideways, it opens on its right, into the strip beside it.
            ...(open && side && { ...openEdges, clipPath: "inset(-40px 0 -40px -40px)" }),
            ...(open && mine && { boxShadow: glow }),
          }}
          className={`${arrival ? "arrival-halo" : ""} flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line-strong bg-surface py-2.5 pr-2.5 pl-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.25)] transition-all duration-150 hover:border-sky-400/50 active:not-[:has(:is(button,a,input,select,textarea,[role=dialog]):active)]:scale-[0.99] ${open ? (side ? "rounded-r-none" : "rounded-b-none") : ""} ${over ? "ring-2 ring-accent" : ""}`}
        >
          <span className="grid h-14 w-14 shrink-0 gap-px overflow-hidden rounded-xl bg-white" style={collageGrid(small.length)}>
            {small.map((p) => (
              <span key={p.id} className="flex min-h-0 min-w-0 items-center justify-center bg-white">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
                  <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" />
                ) : (
                  <Icon name="box" className="h-4 w-4 text-slate-400" />
                )}
              </span>
            ))}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${textColor ? "" : "text-fg"}`} style={textColor ? { color: textColor } : undefined}>
                {pack ? (title ?? `${members.length} part${members.length === 1 ? "" : "s"}`) : material}
                {!pack && machineName && ` · ${machineName}`}
              </span>
              <BatchDate at={batch.createdAt} />
            </span>
            {/* The downloads share this line, so machine and material get the row's full width. Only
                the controls keep their clicks: the rest of the row opens the batch. */}
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              {!pack && <span className="min-w-0 max-w-40">{userBox}</span>}
              {cart && <span onClick={stop}>{cart.delivery}</span>}
              <span onClick={stop}>{statusMenu}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1" onClick={stop}>
                {downloadButtons}
              </span>
            </span>
          </span>
          <Chevron open={open} small />
        </div>
        {layoutDialog}
      </div>
      {panel}
      </>
    );
  }

  // The card looks the same open or closed (outlined while its strip is open below).
  return (
    <>
    <div
      ref={ref}
      data-batch-card=""
      data-arrival={arrival ? "" : undefined}
      {...dropProps}
      draggable={draggable}
      onDragStart={dragStart}
      onClick={toggle}
      style={{
        ...cardTint,
        ...(mine && { boxShadow: "0 0 0 2px rgba(56,189,248,0.75), 0 0 22px 4px rgba(56,189,248,0.4)" }),
        // Open, the card reaches down to its strip (the grid's gap is its own padding), so card
        // and strip meet with no seam (Harel, 2026-11-04).
        ...(open && !side && { ...openEdges, marginBottom: 0, paddingBottom: "var(--fab-gap)", clipPath: "inset(-40px -40px 0 -40px)" }),
        ...(open && side && { ...openEdges, clipPath: "inset(-40px 0 -40px -40px)" }),
        ...(open && mine && { boxShadow: glow }),
      }}
      className={`card-interactive flex cursor-pointer flex-col self-start text-sm ${open ? (side ? "rounded-r-none" : "rounded-b-none") : ""} ${over ? "ring-2 ring-accent" : ""}`}
    >
      {/* Open: a second pixel inside the card's own border, so its outline is as strong as the strip's. */}
      {open && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-10 border ${side ? "rounded-l-[11px] border-r-0" : "rounded-t-[11px] border-b-0"}`}
          style={{ borderColor: edge }}
        />
      )}
      <div className="flex flex-col">
        <div className="relative w-full shrink-0">
          <button
            aria-expanded={open}
            aria-label={open ? `Close ${what}` : `Open ${what}`}
            className="thumb-well grid aspect-[4/3] w-full gap-px overflow-hidden"
            style={collageGrid(thumbs.length)}
          >
            {thumbs.map((p) => (
              <span key={p.id} className="flex min-h-0 items-center justify-center bg-well">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
                  <img src={p.thumbUrl} alt="" loading="lazy" className={`h-full w-full object-contain ${thumbs.length === 1 ? "p-3" : "p-1.5"}`} />
                ) : (
                  <span className="px-1 text-center text-[10px] text-subtle">{partTitle(p)}</span>
                )}
              </span>
            ))}
          </button>
          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start gap-1.5">
            {(!pack || cart) && (
              <span className="pointer-events-auto min-w-0" onClick={stop}>
                {cart ? cart.delivery : userBox}
              </span>
            )}
            <BatchDate at={batch.createdAt} overlay />
          </div>
        </div>
        {cart ? (
          // A cart: its vendor a little bigger, then its order status and the cart button on one row.
          <div className="flex min-w-0 flex-col gap-2 p-3">
            <span className="min-w-0 truncate text-base font-bold text-fg">{title}</span>
            <div className="flex min-w-0 items-center gap-2" onClick={stop}>
              <span className="min-w-0 flex-1">{cart.status}</span>
              <span className="shrink-0">{cart.button}</span>
            </div>
          </div>
        ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          {(!pack || title) && (
            <div className={`min-w-0 truncate text-sm font-semibold ${textColor ? "" : "text-fg"}`} style={textColor ? { color: textColor } : undefined}>
              {pack ? title : material}
              {!pack && machineName && ` · ${machineName}`}
            </div>
          )}
          {/* Only the controls keep their clicks: the rest of the card opens the batch. */}
          <div className="flex flex-wrap items-center gap-2">
            <span onClick={stop} className={pack ? "min-w-0 flex-1" : undefined}>{statusMenu}</span>
            {layoutDialog}
            <span className="ml-auto flex items-center gap-1.5" onClick={stop}>
              {downloadButtons}
            </span>
          </div>
        </div>
        )}
      </div>
    </div>
    {panel}
    </>
  );
}

// An open batch's G-code: Upload G-code, or the file with Replace and Remove. Uploading moves the
// batch's parts that haven't started to Gcoded.
export function GcodeRow({ batch }: { batch: Batch }) {
  const work = useCan("work");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setError(await task());
    setBusy(false);
  };
  const btn = "press rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void run(() => upload({ kind: "group", id: batch.id }, "gcode", file));
        }}
      />
      {batch.gcode ? (
        <>
          <a href={`/api/files/${batch.gcode.id}?download=1`} className="flex min-w-0 items-center gap-1 font-medium text-fg hover:text-accent" title={batch.gcode.filename}>
            <Icon name="gcode" className="h-4 w-4 shrink-0" />
            <span className="truncate">{batch.gcode.filename}</span>
          </a>
          {work && <><button className={btn} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : "Replace"}
          </button>
          <button
            className={`${btn} hover:border-rose-500 hover:text-rose-700`}
            disabled={busy}
            onClick={() => {
              if (confirm("Remove the G-code from this batch?")) void run(async () => (await removeBatchGcode(batch.id)).error ?? null);
            }}
          >
            Remove
          </button></>}
        </>
      ) : !work ? null : (
        <button className={`${btn} flex items-center gap-1`} disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="gcode" className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload G-code"}
        </button>
      )}
      {error && <span className="text-rose-700">{error}</span>}
    </div>
  );
}

// The day a batch was made, alone in its corner (no "Created" beside it). On the collage it sits on
// a frosted pill like the maker's, so it reads over any picture.
export function BatchDate({ at, overlay = false }: { at: string; overlay?: boolean }) {
  return (
    <span
      title="Made on"
      className={`shrink-0 text-[11px] font-semibold whitespace-nowrap text-muted tabular-nums ${overlay ? "ml-auto rounded-full border border-line-strong bg-surface/90 px-2 py-0.5 shadow-sm backdrop-blur-md" : ""}`}
    >
      <LocalTime at={at} style="day" />
    </span>
  );
}

// One file after another: each export can take a while the first time, so they are spaced out.
// One file after another; stops at the first part Onshape can't export (its reason shows as a
// toast), since the rest would most likely fail the same way.
export async function downloadAll(urls: string[]) {
  for (const [i, url] of urls.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const file = await prepareExport(url);
    if (!file) return;
    if (file.filename) {
      const a = document.createElement("a");
      a.href = file.href;
      a.download = file.filename;
      a.click();
      continue;
    }
    // A hidden frame per file, so the browser doesn't stop a run of downloads.
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = file.href;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 120_000);
  }
}
