"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addCondition, addLocation, deleteCondition, deleteLocation } from "@/app/(app)/inventory/actions";
import { CategorySettings } from "@/components/inventory/CategorySettings";
import type { Condition, InvCategory, Location } from "@/components/inventory/types";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import { DEFAULT_MATERIAL_COLORS, NO_MATERIAL, OTHER_MATERIAL } from "@/config/materialColors";
import type { MaterialList } from "@/config/materials";
import {
  addMaterial,
  addMaterialGroup,
  deleteMaterialGroup,
  moveMaterialGroup,
  removeMaterial,
  renameLocation,
  renameMaterial,
  renameMaterialGroup,
  setMaterialColor,
  updateCondition,
  type ActionResult,
} from "./actions";

type Uses = Record<string, { parts: number; items: number }>;

const TABS = [
  { id: "materials", label: "Materials" },
  { id: "categories", label: "Inventory categories" },
  { id: "locations", label: "Locations" },
  { id: "conditions", label: "Conditions" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function SettingsView({
  materials,
  colors,
  uses,
  categories,
  conditions,
  locations,
  items,
}: {
  materials: MaterialList;
  colors: Record<string, string>;
  uses: Uses;
  categories: InvCategory[];
  conditions: Condition[];
  locations: Location[];
  items: { category: string; specs: Record<string, string> }[];
}) {
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "materials";

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Settings" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => pushQuery({ tab: t.id === "materials" ? null : t.id })}
            className={`press min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors duration-150 active:scale-[0.98] ${
              tab === t.id ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-sky-400/40 hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "materials" && <MaterialsSettings materials={materials} colors={colors} uses={uses} />}
      {tab === "categories" && <CategorySettings categories={categories} locations={locations} items={items} />}
      {tab === "locations" && <LocationsSettings locations={locations} />}
      {tab === "conditions" && <ConditionsSettings conditions={conditions} />}
    </div>
  );
}

// Runs an action and keeps its error (or note) to show.
function useRun() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult>({});
  const run = (fn: () => Promise<ActionResult | void>, then?: () => void) =>
    startTransition(async () => {
      const r = (await fn()) ?? {};
      setResult(r);
      if (!r.error) then?.();
    });
  const banner = result.error ? (
    <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{result.error}</p>
  ) : result.message ? (
    <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{result.message}</p>
  ) : null;
  return { run, pending, banner };
}

// ---------- Materials ----------

function MaterialsSettings({ materials, colors, uses }: { materials: MaterialList; colors: Record<string, string>; uses: Uses }) {
  const { run, pending, banner } = useRun();
  const [newGroup, setNewGroup] = useState("");
  const groups = Object.entries(materials);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        The BOM&apos;s material list, by category. Inventory fields of the &quot;BOM material&quot; kind offer the materials of their
        categories, and each category&apos;s colour paints its parts in the 3D viewer&apos;s Material mode.
      </p>
      {banner}
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map(([name, list], i) => (
          <MaterialGroup
            key={name}
            name={name}
            list={list}
            color={colors[name]}
            uses={uses}
            first={i === 0}
            last={i === groups.length - 1}
            run={run}
          />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[OTHER_MATERIAL, NO_MATERIAL].map((name) => (
          <section key={name} className="panel flex items-center gap-3 p-3">
            <ColorSwatch group={name} color={colors[name]} run={run} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{name}</div>
              <div className="text-xs text-muted">{name === OTHER_MATERIAL ? "3D colour of parts whose material isn't on the list" : "3D colour of parts with no material"}</div>
            </div>
          </section>
        ))}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addMaterialGroup(newGroup), () => setNewGroup(""));
        }}
      >
        <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New material category, e.g. Steel Plates" className="input min-h-11 w-72 max-w-full" />
        <button className="btn min-h-11 active:scale-[0.98]" disabled={pending || !newGroup.trim()}>
          + Add category
        </button>
      </form>
    </div>
  );
}

type Run = ReturnType<typeof useRun>["run"];

function MaterialGroup({ name, list, color, uses, first, last, run }: { name: string; list: string[]; color?: string; uses: Uses; first: boolean; last: boolean; run: Run }) {
  const [label, setLabel] = useState(name);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const used = list.reduce((n, m) => n + (uses[m]?.parts ?? 0) + (uses[m]?.items ?? 0), 0);
  const rename = () => {
    if (label.trim() && label.trim() !== name) run(() => renameMaterialGroup(name, label));
    else setLabel(name);
  };

  return (
    <section className="panel space-y-3 p-3 transition-colors duration-150 hover:border-sky-400/40">
      <div className="flex items-center gap-2">
        <ColorSwatch group={name} color={color} run={run} />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Category name"
          className="input min-h-10 min-w-0 flex-1 border-transparent bg-transparent font-semibold hover:border-line-strong focus:border-accent"
        />
        <span className="rounded-full bg-raised px-2 font-mono text-[11px] leading-5 font-semibold text-fg-2 tabular-nums" title="Materials in this category">
          {list.length}
        </span>
        <SmallButton label="Move up" disabled={first} onClick={() => run(() => moveMaterialGroup(name, -1))}>
          ↑
        </SmallButton>
        <SmallButton label="Move down" disabled={last} onClick={() => run(() => moveMaterialGroup(name, 1))}>
          ↓
        </SmallButton>
        <SmallButton
          label="Delete category"
          danger
          onClick={() => {
            const note = used ? ` Parts and items using its materials keep them, but they leave the pickers.` : "";
            if (confirm(`Delete the material category "${name}" and its ${list.length} material${list.length === 1 ? "" : "s"}?${note}`)) run(() => deleteMaterialGroup(name));
          }}
        >
          ✕
        </SmallButton>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {list.map((m) =>
          editing === m ? (
            <MaterialEditor key={m} group={name} material={m} use={uses[m]} run={run} onDone={() => setEditing(null)} />
          ) : (
            <span key={m} className="group/chip inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong bg-surface pr-1 pl-3 text-xs font-semibold">
              <button type="button" onClick={() => setEditing(m)} className="press font-mono tabular-nums hover:text-accent" title="Rename">
                {m}
              </button>
              {(uses[m]?.parts ?? 0) + (uses[m]?.items ?? 0) > 0 && (
                <span className="font-mono text-[10px] text-subtle tabular-nums" title={`${uses[m]?.parts ?? 0} parts, ${uses[m]?.items ?? 0} inventory items`}>
                  {(uses[m]?.parts ?? 0) + (uses[m]?.items ?? 0)}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${m}`}
                onClick={() => {
                  const n = uses[m]?.parts ?? 0;
                  if (!n || confirm(`Remove "${m}" from the list? ${n} part${n === 1 ? " keeps" : "s keep"} it as typed.`)) run(() => removeMaterial(name, m));
                }}
                className="press flex h-7 w-7 items-center justify-center rounded-full text-subtle hover:bg-line hover:text-rose-600"
              >
                ✕
              </button>
            </span>
          ),
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.trim()) run(() => addMaterial(name, adding), () => setAdding(""));
          }}
        >
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add material ⏎" aria-label={`Add a material to ${name}`} className="input min-h-9 w-40 text-xs" />
        </form>
      </div>
    </section>
  );
}

// Renaming a material, with the choice to carry the new name to the parts and items using it.
function MaterialEditor({ group, material, use, run, onDone }: { group: string; material: string; use?: { parts: number; items: number }; run: Run; onDone: () => void }) {
  const [text, setText] = useState(material);
  const n = (use?.parts ?? 0) + (use?.items ?? 0);
  const [carry, setCarry] = useState(n > 0);
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-accent/60 bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => renameMaterial(group, material, text, carry), onDone);
      }}
    >
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Material name" className="input min-h-9 w-48 font-mono text-xs" />
      {n > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-fg-2">
          <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="h-4 w-4" />
          Also rename it on <span className="font-mono tabular-nums">{use?.parts ?? 0}</span> parts and <span className="font-mono tabular-nums">{use?.items ?? 0}</span> items
        </label>
      )}
      <span className="ml-auto" />
      <button type="button" className="btn min-h-9 active:scale-[0.98]" onClick={onDone}>
        Cancel
      </button>
      <button className="btn-primary min-h-9 active:scale-[0.98]" disabled={!text.trim()}>
        Save
      </button>
    </form>
  );
}

// A category's 3D colour: the picker saves a moment after the last change; ↺ puts the default back.
function ColorSwatch({ group, color, run }: { group: string; color?: string; run: Run }) {
  const fallback = DEFAULT_MATERIAL_COLORS[group] ?? DEFAULT_MATERIAL_COLORS[OTHER_MATERIAL];
  const [value, setValue] = useState(color ?? fallback);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <label className="press relative h-9 w-9 cursor-pointer overflow-hidden rounded-lg border border-white/20 shadow-sm active:scale-[0.98]" title="3D colour" style={{ backgroundColor: value }}>
        <input
          type="color"
          value={value}
          aria-label={`${group} 3D colour`}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => run(() => setMaterialColor(group, next)), 500);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      {color && color.toLowerCase() !== fallback.toLowerCase() && (
        <button
          type="button"
          aria-label="Default colour"
          title="Back to the default colour"
          onClick={() => {
            setValue(fallback);
            run(() => setMaterialColor(group, null));
          }}
          className="press flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg"
        >
          ↺
        </button>
      )}
    </span>
  );
}

function SmallButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-sm hover:bg-raised active:scale-[0.98] disabled:opacity-30 ${danger ? "text-rose-600" : "text-fg-2"}`}
    >
      {children}
    </button>
  );
}

// ---------- Locations ----------

function LocationsSettings({ locations }: { locations: Location[] }) {
  const { run, pending, banner } = useRun();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">The shelves and bins items live on. Renaming one keeps its items on it.</p>
      {banner}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((l) => (
          <div key={l.id} className="panel flex items-center gap-2 p-2 transition-colors duration-150 hover:border-sky-400/40">
            <span className="pl-1 text-subtle">📍</span>
            <InlineName value={l.name} label="Location name" onSave={(v) => run(() => renameLocation(l.id, v))} />
            <SmallButton
              label={`Delete ${l.name}`}
              danger
              onClick={() => {
                if (confirm(`Delete the location "${l.name}"? Its items stay, without a location.`)) run(() => deleteLocation(l.id));
              }}
            >
              ✕
            </SmallButton>
          </div>
        ))}
        {!locations.length && <p className="text-sm text-muted">No locations yet.</p>}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addLocation(name), () => setName(""));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shelf or bin, e.g. A1" className="input min-h-11 w-64 max-w-full" />
        <button className="btn min-h-11 active:scale-[0.98]" disabled={pending || !name.trim()}>
          + Add location
        </button>
      </form>
    </div>
  );
}

// ---------- Conditions ----------

function ConditionsSettings({ conditions }: { conditions: Condition[] }) {
  const { run, pending, banner } = useRun();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#22c55e");
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">What state an item is in. The colour marks it on cards and in the table.</p>
      {banner}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {conditions.map((c) => (
          <div key={c.id} className="panel flex items-center gap-2 p-2 transition-colors duration-150 hover:border-sky-400/40">
            <ConditionColor color={c.color} label={c.label} onSave={(v) => run(() => updateCondition(c.id, { color: v }))} />
            <InlineName value={c.label} label="Condition name" onSave={(v) => run(() => updateCondition(c.id, { label: v }))} />
            <SmallButton
              label={`Delete ${c.label}`}
              danger
              onClick={() => {
                if (confirm(`Delete the condition "${c.label}"? Items keep their stock, without a condition.`)) run(() => deleteCondition(c.id));
              }}
            >
              ✕
            </SmallButton>
          </div>
        ))}
        {!conditions.length && <p className="text-sm text-muted">No conditions yet.</p>}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addCondition(label, color), () => setLabel(""));
        }}
      >
        <input value={color} onChange={(e) => setColor(e.target.value)} type="color" className="h-11 w-11 cursor-pointer rounded-lg bg-transparent" aria-label="Color" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New condition" className="input min-h-11 w-64 max-w-full" />
        <button className="btn min-h-11 active:scale-[0.98]" disabled={pending || !label.trim()}>
          + Add condition
        </button>
      </form>
    </div>
  );
}

function ConditionColor({ color, label, onSave }: { color: string; label: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(color);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <label className="press relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-white/20 active:scale-[0.98]" style={{ backgroundColor: value }} title="Colour">
      <input
        type="color"
        value={value}
        aria-label={`${label} colour`}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onSave(next), 500);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

// A name edited in place: saves on Enter or leaving the box, Escape puts it back.
function InlineName({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() && text.trim() !== value) onSave(text);
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="input min-h-9 min-w-0 flex-1 border-transparent bg-transparent text-sm font-semibold hover:border-line-strong focus:border-accent"
    />
  );
}
