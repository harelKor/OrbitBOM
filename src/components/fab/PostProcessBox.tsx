"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { updatePart } from "@/app/(app)/parts-actions";
import { Dialog } from "@/components/Dialog";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { PartCard } from "@/components/bom/PartCard";
import type { CardPart } from "@/components/bom/types";
import { Icon } from "@/components/ui/Icon";
import { FINISHED_STATUS } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { POST_PROCESSING, fabState } from "./fabModel";
import { Notice } from "@/components/ui/Notice";

// The robot dashboard's Post Process box. A click opens every part in Post Processing in a window,
// with To Fab's − / + and check, and a To Fab button (Harel, 2026-11-07). `glow`: Build Team,
// while parts wait. On a PC its text sizes to the box, like Ready for QA's.
export function PostProcessBox({ robotId, parts, inventory, isAdmin, glow = false }: { robotId: string; parts: CardPart[]; inventory: InventoryName[]; isAdmin: boolean; glow?: boolean }) {
  const [open, setOpen] = useState(false);
  // Parts checked off while the window is open stay in it, struck through, after the page's data
  // drops them (they're Ready for QA now), so a second click can undo.
  const [kept, setKept] = useState<Map<string, CardPart>>(() => new Map());
  const listed = useMemo(() => {
    const ids = new Set(parts.map((p) => p.id));
    return [...parts, ...[...kept.values()].filter((p) => !ids.has(p.id))].map(fabState);
  }, [parts, kept]);
  const [optimistic, addOptimistic] = useOptimistic(listed, (state, { id, changes }: { id: string; changes: PartChanges }) =>
    state.map((p) => (p.id === id ? { ...p, ...planPartUpdate(p, changes, "ui").set } : p)),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (id: string, changes: PartChanges) => {
    setError(null);
    startTransition(async () => {
      addOptimistic({ id, changes });
      const r = await updatePart(id, changes);
      if (r.error) setError(r.error);
    });
  };
  const keep = (p: CardPart, on: boolean) =>
    setKept((k) => {
      const next = new Map(k);
      if (on) next.set(p.id, p);
      else next.delete(p.id);
      return next;
    });
  // The same rules as To Fab's To Post Process: the check moves the part to Ready for QA with all
  // of it post-processed (again: back); − / + count pieces and move it once all are done.
  const checkPost = (p: CardPart) => {
    const undo = kept.has(p.id);
    const need = Math.max(p.quantity, 1);
    keep(p, !undo);
    save(p.id, undo ? { status: POST_PROCESSING, postDone: Math.min(p.postDone, need - 1) } : { status: FINISHED_STATUS, postDone: need });
  };
  const countPost = (p: CardPart, n: number) => {
    const need = Math.max(p.quantity, 1);
    const done = Math.min(Math.max(n, 0), need);
    const wasChecked = kept.has(p.id);
    // Sent as a step from the saved count, so two phones counting the same part both count.
    const add = { postDone: done - p.postDone };
    if (done >= need && !wasChecked) {
      keep(p, true);
      save(p.id, { add, status: FINISHED_STATUS });
    } else if (done < need && wasChecked) {
      keep(p, false);
      save(p.id, { add, status: POST_PROCESSING });
    } else save(p.id, { add });
  };
  const close = () => {
    setOpen(false);
    setKept(new Map());
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-arrival={glow ? "" : undefined}
        className="card-interactive group flex min-h-32 flex-col justify-between gap-2 overflow-hidden p-4 text-left active:scale-[0.98] sm:p-5 @5xl/dash:[container-type:size]"
      >
        <span className="block text-xl leading-tight font-bold text-fg sm:text-2xl @5xl/dash:text-[min(1.5rem,11.5cqw,11cqh)]">Post Process</span>
        <span className="display font-mono text-7xl leading-none text-accent tabular-nums sm:text-8xl @5xl/dash:text-[min(6rem,36cqh,40cqw)]">{parts.length}</span>
      </button>
      <Dialog
        open={open}
        onClose={close}
        title="Post Process"
        wide
        actions={
          <Link href={`/robots/${robotId}/fab`} onClick={close} className="btn-primary inline-flex items-center gap-1.5">
            To Fab
            <Icon name="arrow" className="h-4 w-4" />
          </Link>
        }
      >
        {error && <Notice tone="error" className="mb-3">Couldn&apos;t save: {error}</Notice>}
        {optimistic.length === 0 ? (
          <p className="text-sm text-muted">No parts are waiting for post-processing.</p>
        ) : (
          <BomProvider value={{ inventory, isAdmin, robotId }}>
            <div className="card-grid">
              {optimistic.map((p) => (
                <PartCard
                  key={p.id}
                  part={p}
                  save={(c) => save(p.id, c)}
                  showSystem
                  checked={kept.has(p.id)}
                  onCheck={() => checkPost(p)}
                  checkFrom={POST_PROCESSING}
                  checkTo={FINISHED_STATUS}
                  post={{ done: p.postDone, onChange: (n) => countPost(p, n) }}
                />
              ))}
            </div>
          </BomProvider>
        )}
      </Dialog>
    </>
  );
}
