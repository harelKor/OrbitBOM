"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { getMachine } from "@/config/machines";
import { STATUSES } from "@/config/statuses";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BulkEditBar } from "./BulkEditBar";
import { matchesDate, useFilters } from "@/components/shell/FilterContext";
import { useEditMode } from "@/components/shell/ModeContext";
import { MergeBar, type MergeInfo } from "./MergeBar";
import { MERGE_PREFIX, fanOutChanges, isMergeId, mergedRow } from "@/lib/merges/merge";
import { BomProvider, type InventoryName } from "./BomContext";
import { KanbanView } from "./KanbanView";
import { PartCard } from "./PartCard";
import { TableView } from "./TableView";
import { partTitle, type CardPart } from "./types";

type View = "card" | "table" | "kanban";
type Chip = "all" | "cots" | "inhouse";

// The BOM page body (ref §3): the top bar's search and filters, type chips, a Status select,
// the Card / Table / Kanban views, and (Edit mode) Bulk edit and Merge. Edits show at once and
// roll back if the save fails.
export function BomView({
  parts,
  inventory = [],
  isAdmin = false,
  showSystem = false,
  allowBulkEdit = true,
  merges = [],
  mergeSystemId,
  robotId,
  toolbar,
}: {
  parts: CardPart[];
  inventory?: InventoryName[];
  isAdmin?: boolean;
  showSystem?: boolean;
  allowBulkEdit?: boolean;
  merges?: MergeInfo[];
  mergeSystemId?: string; // set on a system page: enables Merge parts
  robotId?: string; // enables Locate on the cards
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const edit = useEditMode();
  // View mode always shows cards; Table and Kanban are Edit-mode views.
  const view = edit ? (searchParams.get("view") as View) || "card" : "card";
  const setView = (v: View) => {
    const params = new URLSearchParams(searchParams);
    if (v === "card") params.delete("view");
    else params.set("view", v);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const [optimisticParts, addOptimistic] = useOptimistic(
    parts,
    (state, { ids, changes }: { ids: string[]; changes: PartChanges }) => {
      // A merged row's edit lands on its members, the way the server applies it.
      const perPart = new Map<string, PartChanges>();
      for (const id of ids) {
        const merge = isMergeId(id) ? merges.find((m) => `${MERGE_PREFIX}${m.id}` === id) : undefined;
        if (!merge) perPart.set(id, changes);
        else {
          const members = merge.partIds.map((pid) => state.find((p) => p.id === pid)).filter((p) => !!p);
          for (const pm of fanOutChanges(members, changes).perMember) perPart.set(pm.id, pm.changes);
        }
      }
      return state.map((p) => (perPart.has(p.id) ? { ...p, ...planPartUpdate(p, perPart.get(p.id)!, "ui").set } : p));
    },
  );
  // Merged listings replace their members with one row, where the first member was.
  const optimistic = useMemo(() => {
    if (!merges.length) return optimisticParts;
    const mergeOf = new Map(merges.flatMap((m) => m.partIds.map((id) => [id, m] as const)));
    const out: CardPart[] = [];
    for (const p of optimisticParts) {
      const merge = mergeOf.get(p.id);
      if (!merge) out.push(p);
      else if (merge.partIds[0] === p.id) {
        const members = merge.partIds.map((id) => optimisticParts.find((x) => x.id === id)).filter((x) => !!x);
        if (members.length) out.push(mergedRow(merge, members));
      }
    }
    // A merge whose first member is filtered out of `parts` still shows via another member.
    for (const merge of merges) {
      if (!optimisticParts.some((p) => p.id === merge.partIds[0])) {
        const members = merge.partIds.map((id) => optimisticParts.find((x) => x.id === id)).filter((x) => !!x);
        if (members.length) out.push(mergedRow(merge, members));
      }
    }
    return out;
  }, [optimisticParts, merges]);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(ids: string[], changes: PartChanges) {
    setError(null);
    startTransition(async () => {
      addOptimistic({ ids, changes });
      const result = ids.length === 1 ? await updatePart(ids[0], changes) : await updateParts(ids, changes);
      if (result.error) setError(result.error);
    });
  }
  const saveFor = (id: string) => (changes: PartChanges) => save([id], changes);

  const { filters } = useFilters();
  const { q, material, process, date } = filters;
  const [chip, setChip] = useState<Chip>("all");
  const [status, setStatus] = useState("");
  const [chosenMode, setMode] = useState<"bulk" | "merge" | null>(null);
  const mode = edit ? chosenMode : null; // leaving Edit mode ends Bulk edit and Merge
  const selecting = mode !== null;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return optimistic.filter((p) => {
      if (chip === "cots" && p.classification !== "cots") return false;
      if (chip === "inhouse" && p.classification !== "inhouse") return false;
      if (process && ![p.preProcess, p.process1, p.process2].includes(process)) return false;
      if (material && p.material !== material) return false;
      if (!matchesDate(p.lastModifiedAt, date)) return false;
      if (status && computeStatus(p) !== status) return false;
      if (!needle) return true;
      const haystack = [
        partTitle(p),
        p.onshapeName,
        p.material,
        ...[p.preProcess, p.process1, p.process2].map((m) => (m ? getMachine(m)?.name : null)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [optimistic, q, chip, material, process, date, status]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: "All" },
    { id: "cots", label: "COTS" },
    { id: "inhouse", label: "In-house" },
  ];

  return (
    <BomProvider value={{ inventory, isAdmin, robotId }}>
    <div className={`space-y-4 ${selecting ? "pb-20" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`press rounded-full border px-3 py-1 text-xs font-medium ${
                chip === c.id ? "border-accent bg-accent text-white" : "border-line-strong text-slate-300 hover:border-slate-400 hover:bg-raised hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
          {edit && <div className="flex overflow-hidden rounded-md border border-line-strong" role="group" aria-label="View">
            {(["card", "table", "kanban"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`press px-3 py-1 text-xs font-medium capitalize ${view === v ? "bg-accent text-white" : "bg-raised text-slate-300 hover:bg-line"}`}
              >
                {v}
              </button>
            ))}
          </div>}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto rounded-full py-1 text-xs" aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          {edit && allowBulkEdit && view !== "kanban" && (
            <button className={mode === "bulk" ? "btn-primary" : "btn"} onClick={() => setMode((m) => (m === "bulk" ? null : "bulk"))}>
              Bulk edit
            </button>
          )}
          {edit && mergeSystemId && view !== "kanban" && (
            <button className={mode === "merge" ? "btn-primary" : "btn"} onClick={() => setMode((m) => (m === "merge" ? null : "merge"))}>
              Merge parts
            </button>
          )}
          {edit && toolbar}
      </div>

      {error && <p className="rounded-md bg-rose-950 p-3 text-sm text-rose-200">Couldn&apos;t save: {error}</p>}

      <div className="text-xs text-slate-500 tabular-nums">
        {shown.length === optimistic.length ? `${optimistic.length} parts` : `${shown.length} of ${optimistic.length} parts`}
      </div>

      {view === "table" ? (
        <TableView parts={shown} saveFor={saveFor} showSystem={showSystem} selection={selecting ? { ids: selected, toggle } : undefined} />
      ) : view === "kanban" ? (
        <KanbanView parts={shown} saveFor={saveFor} showSystem={showSystem} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {shown.map((p) => (
            <PartCard
              key={p.id}
              part={p}
              save={saveFor(p.id)}
              showSystem={showSystem}
              selected={selected.has(p.id)}
              onToggleSelect={selecting ? () => toggle(p.id) : undefined}
            />
          ))}
        </div>
      )}

      {mode === "bulk" && (
        <BulkEditBar
          count={selected.size}
          total={shown.length}
          onApply={(changes) => save([...selected], changes)}
          onSelectAll={() => setSelected(new Set(shown.map((p) => p.id)))}
          onDone={() => {
            setMode(null);
            setSelected(new Set());
          }}
        />
      )}
      {mode === "merge" && mergeSystemId && (
        <MergeBar
          systemId={mergeSystemId}
          selected={optimistic.filter((p) => selected.has(p.id))}
          onDone={() => {
            setMode(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
    </BomProvider>
  );
}
