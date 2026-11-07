"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { STATUSES } from "@/config/statuses";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BulkEditBar } from "./BulkEditBar";
import { useFilters } from "@/components/shell/FilterContext";
import { usePermissions } from "@/components/shell/ModeContext";
import { BUILD_STATUSES } from "@/components/shell/mode";
import { useEscape } from "@/components/ui/useEscape";
import { DrawingsBar } from "./DrawingsBar";
import { MergeBar, type MergeInfo } from "./MergeBar";
import { RELEASED_STATUS, ReleaseBar } from "./ReleaseBar";
import { SuggestBar } from "./SuggestBar";
import { MERGE_PREFIX, fanOutChanges, isMergeId, mergedRow } from "@/lib/merges/merge";
import type { VersionTags } from "@/lib/versions/tags";
import { BomProvider, type InventoryName } from "./BomContext";
import { matchesPills, matchesTopBar } from "./filter";
import { FilterPills } from "./FilterPills";
import { KanbanView } from "./KanbanView";
import { PartCard } from "./PartCard";
import { PartList, PartListRow } from "./PartListRow";
import { useStoredChoice } from "@/components/ui/useStoredChoice";
import { TableView } from "./TableView";
import { type CardPart } from "./types";
import { Icon } from "@/components/ui/Icon";
import { SuggestIcon } from "@/components/ui/SuggestIcon";

// Parts grouped by system, systems in name order.
function bySystem(parts: CardPart[]): [string, CardPart[]][] {
  const groups = new Map<string, CardPart[]>();
  for (const p of parts) groups.set(p.systemName, [...(groups.get(p.systemName) ?? []), p]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

type View = "card" | "list" | "table" | "kanban";
const LOOKS = ["card", "list"] as const; // the views every mode has, remembered by this browser
type Chip = "all" | "cots" | "inhouse" | "review";

// The BOM page body (ref §3): the top bar's search, Material and Process pills, type chips, a Status select,
// the Cards / List / Table / Kanban views, and (Edit mode) Bulk edit and Merge. Edits show at once and
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
  groupBySystem = false,
  allowRelease = false,
  versions,
  stickyToolbar = false,
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
  groupBySystem?: boolean; // card view: one collapsible section per system
  stickyToolbar?: boolean; // a system page: the toolbar stays under the top bar while scrolling
  allowRelease?: boolean; // a system page: the Release button (View and Edit mode)
  versions?: VersionTags; // a system page: the cards' Up to date / Outdated tags
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canManage, canShape, canWork, canDraw, canReview, mode: role } = usePermissions();
  // A system page gives the CAD Team the admin's toolbar too: Table and Kanban, Bulk edit, Merge
  // parts and + Manual part (deletes and settings stay with admins in Edit).
  const edit = canManage || (canShape && !!mergeSystemId);
  // Cards or List in any mode (this browser remembers which); Table and Kanban are Edit-mode views.
  const [look, setLook] = useStoredChoice("orbit-bom-view", LOOKS, "card");
  const asked = searchParams.get("view");
  const view: View = edit && (asked === "table" || asked === "kanban") ? asked : look;
  const setView = (v: View) => {
    const params = new URLSearchParams(searchParams);
    if (v === "card" || v === "list") {
      setLook(v);
      params.delete("view");
    } else params.set("view", v);
    // Only the URL changes: the views are drawn here from the same parts, so there is nothing to
    // ask the server for.
    window.history.replaceState(null, "", `${pathname}${params.size ? `?${params}` : ""}`);
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
  const [chip, setChip] = useState<Chip>("all");
  const [status, setStatus] = useState("");
  const [chosenMode, setMode] = useState<"bulk" | "merge" | "drawings" | "release" | "suggest" | null>(null);
  // Leaving Edit mode ends Bulk edit and Merge; Release works in both modes.
  const mode = edit || (chosenMode === "release" && canWork) || (chosenMode === "drawings" && canDraw) || (chosenMode === "suggest" && canReview) ? chosenMode : null;
  const selecting = mode !== null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEscape(selecting, () => {
    setMode(null);
    setSelected(new Set());
  });

  const shown = useMemo(
    () =>
      optimistic.filter((p) => {
        if (chip === "cots" && p.classification !== "cots") return false;
        if (chip === "inhouse" && p.classification !== "inhouse") return false;
        if (chip === "review" && !p.review) return false;
        if (status && computeStatus(p) !== status) return false;
        return matchesTopBar(p, filters) && matchesPills(p, filters);
      }),
    [optimistic, filters, chip, status],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cards = (list: CardPart[], withSystem: boolean) =>
    view === "list" ? (
      <PartList>
        {list.map((p) => (
          <PartListRow key={p.id} part={p} save={saveFor(p.id)} selected={selected.has(p.id)} onToggleSelect={selecting ? () => toggle(p.id) : undefined} />
        ))}
      </PartList>
    ) : (
    <div className="card-grid">
      {list.map((p) => (
        <PartCard
          key={p.id}
          part={p}
          save={saveFor(p.id)}
          showSystem={withSystem}
          selected={selected.has(p.id)}
          onToggleSelect={selecting ? () => toggle(p.id) : undefined}
        />
      ))}
    </div>
    );

  // A system page's To review chip: the parts whose suggestion waits for approval, each with its
  // ✓ / ✕ (CardSuggest), for whoever can review (Harel, 2026-11-07).
  const toReview = canReview && mergeSystemId ? optimistic.filter((p) => p.review).length : 0;
  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: "All" },
    { id: "cots", label: "COTS" },
    { id: "inhouse", label: "In-house" },
    ...(canReview && mergeSystemId ? [{ id: "review" as const, label: `To review ${toReview}` }] : []),
  ];

  return (
    <BomProvider value={{ inventory, isAdmin, robotId, versions }}>
    {/* With the sticky toolbar, a card jumped to (#part-…) lands below both bars. */}
    <div className={`space-y-4 ${selecting ? "pb-20" : ""} ${stickyToolbar ? "[&_[id^=part-]]:scroll-mt-[calc(var(--topbar-h)+5rem)]" : ""}`}>
      <div
        className={`flex flex-wrap items-center gap-3 ${
          // Sticks right under the top bar (whatever its height); the strip bleeds into main's padding so cards scroll
          // under it cleanly. On phones it stays one row that scrolls sideways, so it doesn't cover the cards.
          stickyToolbar
            ? "sticky top-[var(--topbar-h)] z-10 -mx-4 border-b border-line bg-ink/95 px-4 py-2.5 backdrop-blur max-md:flex-nowrap max-md:overflow-x-auto max-md:[&>*]:shrink-0 md:-mx-6 md:px-6"
            : ""
        }`}
      >
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`press rounded-full border px-3 py-1 text-xs font-medium ${
                chip === c.id ? "border-accent bg-accent text-white" : "border-line-strong text-fg-2 hover:border-accent/50 hover:bg-raised hover:text-fg"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
          <FilterPills />
          <div className="flex overflow-hidden rounded-md border border-line-strong" role="group" aria-label="View">
            {(edit ? (["card", "list", "table", "kanban"] as const) : LOOKS).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`press px-3 py-1 text-xs font-medium capitalize ${view === v ? "bg-accent text-white" : "bg-raised text-fg-2 hover:bg-line"}`}
              >
                {v === "card" ? "Cards" : v}
              </button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto rounded-full py-1 text-xs" aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.filter((s) => role !== "build" || BUILD_STATUSES.includes(s.name)).map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          {allowRelease && canWork && view !== "kanban" && (
            <button className={mode === "release" ? "btn-primary" : "btn"} onClick={() => setMode((m) => (m === "release" ? null : "release"))}>
              Release
            </button>
          )}
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
          {canDraw && mergeSystemId && view !== "kanban" && (
            <button className={mode === "drawings" ? "btn-primary" : "btn"} onClick={() => setMode((m) => (m === "drawings" ? null : "drawings"))}>
              Drawings
            </button>
          )}
          {canReview && mergeSystemId && view !== "kanban" && (
            <button
              className={`${mode === "suggest" ? "btn-primary" : "btn"} inline-flex items-center gap-1.5`}
              onClick={() => setMode((m) => (m === "suggest" ? null : "suggest"))}
              title="Pick parts, set up or not, and get fresh setup and inventory suggestions for To Review"
            >
              <SuggestIcon className="h-4 w-4 text-amber-500" />
              Suggest
            </button>
          )}
          {edit && toolbar}
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

      <div className="text-xs text-subtle tabular-nums">
        {shown.length === optimistic.length ? `${optimistic.length} parts` : `${shown.length} of ${optimistic.length} parts`}
      </div>

      {view === "table" ? (
        <TableView parts={shown} saveFor={saveFor} showSystem={showSystem} selection={selecting ? { ids: selected, toggle } : undefined} />
      ) : view === "kanban" ? (
        <KanbanView parts={shown} saveFor={saveFor} showSystem={showSystem} />
      ) : groupBySystem ? (
        <div className="space-y-3">
          {bySystem(shown).map(([name, group]) => (
            <details key={name} open className="group/sys">
              <summary className="press flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-semibold text-fg-2 hover:text-fg">
                <span className="-m-1 inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-raised">
                  <Icon name="chevron" className="h-4.5 w-4.5 transition-transform group-open/sys:rotate-90" />
                </span>
                {name}
                <span className="text-xs font-normal text-subtle tabular-nums">{group.length}</span>
              </summary>
              <div className="mt-2">{cards(group, false)}</div>
            </details>
          ))}
        </div>
      ) : (
        cards(shown, showSystem)
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
      {mode === "release" && (
        <ReleaseBar
          count={selected.size}
          selected={shown.filter((p) => selected.has(p.id))}
          total={shown.length}
          onRelease={(ids) => {
            save(ids, { status: RELEASED_STATUS });
            setMode(null);
            setSelected(new Set());
          }}
          onSelectAll={() => setSelected(new Set(shown.map((p) => p.id)))}
          onDone={() => {
            setMode(null);
            setSelected(new Set());
          }}
        />
      )}
      {mode === "suggest" && mergeSystemId && (
        <SuggestBar
          selected={shown.filter((p) => selected.has(p.id))}
          total={shown.length}
          onSelectAll={() => setSelected(new Set(shown.map((p) => p.id)))}
          onSelectUndefined={() => setSelected(new Set(shown.filter((p) => p.classification === "undefined").map((p) => p.id)))}
          onClear={() => setSelected(new Set())}
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
      {mode === "drawings" && mergeSystemId && (
        <DrawingsBar
          systemId={mergeSystemId}
          selected={shown.filter((p) => selected.has(p.id))}
          total={shown.length}
          onSelectAll={() => setSelected(new Set(shown.map((p) => p.id)))}
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
