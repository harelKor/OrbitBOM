"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { getMachine, MACHINES } from "@/config/machines";
import { MATERIALS } from "@/config/materials";
import { STATUSES } from "@/config/statuses";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BulkEditBar } from "./BulkEditBar";
import { InventoryProvider, type InventoryName } from "./InventoryContext";
import { KanbanView } from "./KanbanView";
import { PartCard } from "./PartCard";
import { TableView } from "./TableView";
import { partTitle, type CardPart } from "./types";

type View = "card" | "table" | "kanban";
type Chip = "all" | "cots" | "inhouse" | string; // or a machine id

// The BOM page body (ref §3): search, filter chips, Material and Status selects, the Card /
// Table / Kanban views, and Bulk edit. Edits show at once and roll back if the save fails.
export function BomView({
  parts,
  memberNames,
  inventory = [],
  showSystem = false,
  allowBulkEdit = true,
  toolbar,
}: {
  parts: CardPart[];
  memberNames: string[];
  inventory?: InventoryName[];
  showSystem?: boolean;
  allowBulkEdit?: boolean;
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = (searchParams.get("view") as View) || "card";
  const setView = (v: View) => {
    const params = new URLSearchParams(searchParams);
    if (v === "card") params.delete("view");
    else params.set("view", v);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const [optimistic, addOptimistic] = useOptimistic(
    parts,
    (state, { ids, changes }: { ids: string[]; changes: PartChanges }) =>
      state.map((p) => (ids.includes(p.id) ? { ...p, ...planPartUpdate(p, changes, "ui").set } : p)),
  );
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

  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [material, setMaterial] = useState("");
  const [status, setStatus] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return optimistic.filter((p) => {
      if (chip === "cots" && p.classification !== "cots") return false;
      if (chip === "inhouse" && p.classification !== "inhouse") return false;
      if (!["all", "cots", "inhouse"].includes(chip) && ![p.preProcess, p.process1, p.process2].includes(chip))
        return false;
      if (material && p.material !== material) return false;
      if (status && computeStatus(p) !== status) return false;
      if (!needle) return true;
      const haystack = [
        partTitle(p),
        p.onshapeName,
        p.material,
        p.description,
        ...[p.preProcess, p.process1, p.process2].map((m) => (m ? getMachine(m)?.name : null)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [optimistic, q, chip, material, status]);

  // The Material filter lists the materials present in this BOM, grouped like the config.
  const presentMaterials = useMemo(() => {
    const present = new Set(optimistic.map((p) => p.material).filter(Boolean) as string[]);
    const groups = Object.entries(MATERIALS)
      .map(([group, list]) => [group, list.filter((m) => present.has(m))] as const)
      .filter(([, list]) => list.length);
    const known = new Set(Object.values(MATERIALS).flat());
    const other = [...present].filter((m) => !known.has(m)).sort();
    return other.length ? [...groups, ["Other", other] as const] : groups;
  }, [optimistic]);

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
    ...MACHINES.map((m) => ({ id: m.id, label: m.name })),
  ];

  return (
    <InventoryProvider value={inventory}>
    <div className={`space-y-4 ${selecting ? "pb-20" : ""}`}>
      <div className="panel space-y-3 p-4">
        <div className="relative">
          <input
            ref={search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search parts by name, part number, material, process…"
            className="input pr-16"
          />
          <kbd className="absolute top-1.5 right-2 rounded border border-slate-700 px-1.5 text-[11px] text-slate-500">Ctrl K</kbd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                chip === c.id ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-slate-700" role="group" aria-label="View">
            {(["card", "table", "kanban"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm capitalize ${view === v ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className="input w-auto" aria-label="Material">
            <option value="">— All Materials —</option>
            {presentMaterials.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto" aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          {allowBulkEdit && view !== "kanban" && (
            <button className={selecting ? "btn-primary" : "btn"} onClick={() => setSelecting((s) => !s)}>
              Bulk edit
            </button>
          )}
          {toolbar}
        </div>
      </div>

      {error && <p className="rounded-md bg-rose-950 p-3 text-sm text-rose-200">Couldn&apos;t save: {error}</p>}

      <div className="text-sm text-slate-400">
        {shown.length === optimistic.length ? `${optimistic.length} parts` : `${shown.length} of ${optimistic.length} parts`}
      </div>

      {view === "table" ? (
        <TableView parts={shown} saveFor={saveFor} showSystem={showSystem} selection={selecting ? { ids: selected, toggle } : undefined} />
      ) : view === "kanban" ? (
        <KanbanView parts={shown} saveFor={saveFor} showSystem={showSystem} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((p) => (
            <PartCard
              key={p.id}
              part={p}
              save={saveFor(p.id)}
              memberNames={memberNames}
              showSystem={showSystem}
              selected={selected.has(p.id)}
              onToggleSelect={selecting ? () => toggle(p.id) : undefined}
            />
          ))}
        </div>
      )}

      {selecting && (
        <BulkEditBar
          count={selected.size}
          total={shown.length}
          onApply={(changes) => save([...selected], changes)}
          onSelectAll={() => setSelected(new Set(shown.map((p) => p.id)))}
          onDone={() => {
            setSelecting(false);
            setSelected(new Set());
          }}
        />
      )}
    </div>
    </InventoryProvider>
  );
}
