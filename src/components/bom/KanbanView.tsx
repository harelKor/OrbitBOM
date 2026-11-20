"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useId } from "react";
import { machineName } from "@/config/machines";
import { COTS_STATUSES } from "@/config/cots";
import { STATUSES } from "@/config/statuses";
import { computeStatus, numberedFor, processMachines } from "@/lib/status";
import { StatusPill, TypeField, type SaveFn } from "./fields";
import { Thumb } from "./Thumb";
import { partIds, partTitle, type CardPart } from "./types";
import { statusTint } from "@/components/ui/statusTint";

// FRCBOM's Kanban (ref §3): one column per status; dragging a card to a column sets its status.
export function KanbanView({
  parts,
  saveFor,
  showSystem,
}: {
  parts: CardPart[];
  saveFor: (id: string) => SaveFn;
  showSystem: boolean;
}) {
  // A small drag threshold keeps clicks on the card's editors working.
  const dndId = useId(); // stable ids so server and client render the same aria attributes
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // COTS-only statuses get a column once a part is in one.
  const columns: { name: string; color: string }[] = [...STATUSES];
  for (const c of COTS_STATUSES) if (!columns.some((s) => s.name === c.name) && parts.some((p) => computeStatus(p) === c.name)) columns.push(c);
  const byStatus = new Map<string, CardPart[]>(columns.map((s) => [s.name, []]));
  for (const p of parts) byStatus.get(computeStatus(p))?.push(p);

  function onDragEnd(e: DragEndEvent) {
    const status = e.over?.id;
    const part = parts.find((p) => p.id === e.active.id);
    if (!part || typeof status !== "string" || computeStatus(part) === status) return;
    // Released P2+ / In Process 2+ is the part's own numbered status; a part with no added process has none.
    const picked = numberedFor(part, status);
    if (picked) saveFor(part.id)({ status: picked });
  }

  return (
    <DndContext id={dndId} sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((s) => {
          const list = byStatus.get(s.name) ?? [];
          const pct = parts.length ? Math.round((list.length / parts.length) * 100) : 0;
          return (
            <Column key={s.name} id={s.name} color={s.color} title={`${s.name}`} meta={`${list.length} · ${pct}%`}>
              {list.map((p) => (
                <KanbanCard key={p.id} part={p} save={saveFor(p.id)} showSystem={showSystem} />
              ))}
            </Column>
          );
        })}
      </div>
    </DndContext>
  );
}

function Column({ id, color, title, meta, children }: { id: string; color: string; title: string; meta: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 ${isOver ? "border-accent bg-raised/60" : "border-line bg-surface/60"}`}>
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="uppercase">{title}</span>
        <span className="ml-auto text-subtle">{meta}</span>
      </div>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </div>
  );
}

function KanbanCard({ part, save, showSystem }: { part: CardPart; save: SaveFn; showSystem: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: part.id });
  const machines = processMachines(part).map(machineName);
  return (
    <div
      ref={setNodeRef}
      data-part={partIds(part)}
      {...listeners}
      {...attributes}
      id={`part-${part.id}`}
      style={{ ...statusTint(computeStatus(part)), ...(transform && { transform: `translate(${transform.x}px, ${transform.y}px)` }) }}
      className={`cursor-grab rounded-lg border border-line-strong bg-surface p-2 text-xs ${isDragging ? "z-50 opacity-80 shadow-xl" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        {part.thumbUrl && <Thumb part={part} size={28} />}
        <span className="flex-1 font-semibold text-accent-soft">{partTitle(part)}</span>
        <span className="text-muted">×{part.quantity}</span>
      </div>
      {showSystem && <div className="text-subtle">{part.systemName}</div>}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <TypeField part={part} save={save} />
        {machines.map((m) => (
          <span key={m} className="rounded bg-raised px-1.5 py-0.5 text-fg-2">{m}</span>
        ))}
      </div>
      {part.material && <div className="mt-1 text-muted">{part.material}</div>}
      <div className="mt-1"><StatusPill status={computeStatus(part)} /></div>
      {part.note && <div className="mt-1 line-clamp-2 text-subtle">{part.note}</div>}
    </div>
  );
}
