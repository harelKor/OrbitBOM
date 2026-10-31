"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addCondition, addLocation, deleteCondition, deleteLocation } from "@/app/(app)/inventory/actions";
import { CategorySettings } from "@/components/inventory/CategorySettings";
import { BackupsSettings, type ScopeInfo } from "@/components/settings/BackupsSettings";
import { LayoutsDocumentSettings, type RobotLayoutsDoc } from "@/components/settings/LayoutsDocumentSettings";
import type { Condition, InvCategory, Location } from "@/components/inventory/types";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import type { BackupFile } from "@/lib/storage/backup";
import { addBaseMaterial, deleteBaseMaterial, renameBaseMaterial, renameLocation, updateCondition, type ActionResult } from "./actions";

const TABS = [
  { id: "categories", label: "Inventory categories" },
  { id: "materials", label: "Materials" },
  { id: "locations", label: "Locations" },
  { id: "conditions", label: "Conditions" },
  { id: "layouts", label: "Batch layouts" },
  { id: "backups", label: "Backups" },
] as const;
type Tab = (typeof TABS)[number]["id"];
type BaseMaterial = { id: string; name: string };

export function SettingsView({
  categories,
  materials,
  conditions,
  locations,
  items,
  backups,
  restoreScopes,
  isAdmin,
  robots,
}: {
  categories: InvCategory[];
  materials: BaseMaterial[];
  conditions: Condition[];
  locations: Location[];
  items: { category: string; specs: Record<string, string> }[];
  backups: BackupFile[];
  restoreScopes: ScopeInfo[];
  isAdmin: boolean;
  robots: RobotLayoutsDoc[];
}) {
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "categories";

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Settings" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => pushQuery({ tab: t.id === "categories" ? null : t.id })}
            className={`press min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors duration-150 active:scale-[0.98] ${
              tab === t.id ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-sky-400/40 hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "categories" && <CategorySettings categories={categories} baseMaterials={materials.map((m) => m.name)} locations={locations} items={items} />}
      {tab === "materials" && <MaterialsSettings materials={materials} />}
      {tab === "locations" && <LocationsSettings locations={locations} />}
      {tab === "conditions" && <ConditionsSettings conditions={conditions} />}
      {tab === "layouts" && <LayoutsDocumentSettings robots={robots} />}
      {tab === "backups" && <BackupsSettings backups={backups} scopes={restoreScopes} isAdmin={isAdmin} />}
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

// ---------- Base materials ----------

function MaterialsSettings({ materials }: { materials: BaseMaterial[] }) {
  const { run, pending, banner } = useRun();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        What things are made of, like Aluminum, 7075-T6 or Delrin. Inventory material fields offer these; a field can narrow them to a few in its category&apos;s settings. Renaming one renames it on every item that has it.
      </p>
      {banner}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {materials.map((m) => (
          <div key={m.id} className="panel flex items-center gap-2 p-2 transition-colors duration-150 hover:border-sky-400/40">
            <InlineName value={m.name} label="Material name" onSave={(v) => run(() => renameBaseMaterial(m.id, v))} />
            <SmallButton
              label={`Remove ${m.name}`}
              danger
              onClick={() => {
                if (confirm(`Remove "${m.name}" from the list? Items that have it keep it.`)) run(() => deleteBaseMaterial(m.id));
              }}
            >
              ✕
            </SmallButton>
          </div>
        ))}
        {!materials.length && <p className="text-sm text-muted">No materials yet.</p>}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addBaseMaterial(name), () => setName(""));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Material, e.g. Titanium" className="input min-h-11 w-64 max-w-full" />
        <button className="btn min-h-11 active:scale-[0.98]" disabled={pending || !name.trim()}>
          + Add material
        </button>
      </form>
    </div>
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
