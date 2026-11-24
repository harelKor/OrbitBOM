"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addCondition, deleteCondition } from "@/app/(app)/inventory/actions";
import { MapSettings, type DrawerSystem } from "@/components/settings/MapSettings";
import { CategorySettings } from "@/components/inventory/CategorySettings";
import { BackupsSettings, type ScopeInfo } from "@/components/settings/BackupsSettings";
import { RecentlyDeleted, type DeletedEntry } from "@/components/settings/RecentlyDeleted";
import { LayoutsDocumentSettings, type RobotLayoutsDoc } from "@/components/settings/LayoutsDocumentSettings";
import type { Condition, InvCategory, Location } from "@/components/inventory/types";
import type { ConditionScope } from "@/lib/inventory/variants";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { Popover } from "@/components/bom/Popover";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import { Notice } from "@/components/ui/Notice";
import { askConfirm } from "@/components/ui/useConfirm";
import type { BackupFile } from "@/lib/storage/backup";
import { addBaseMaterial, addBore, deleteBaseMaterial, deleteBore, renameBaseMaterial, renameBore, updateCondition, type ActionResult } from "./actions";

const TABS = [
  { id: "categories", label: "Inventory categories" },
  { id: "materials", label: "Materials" },
  { id: "bores", label: "Bores" },
  { id: "map", label: "Map" },
  { id: "conditions", label: "Conditions" },
  { id: "layouts", label: "Batch layouts" },
  { id: "backups", label: "Backups" },
  { id: "deleted", label: "Recently deleted" },
] as const;
type Tab = (typeof TABS)[number]["id"];
type BaseMaterial = { id: string; name: string };

export function SettingsView({
  categories,
  materials,
  bores,
  conditions,
  locations,
  drawerSystems,
  items,
  backups,
  restoreScopes,
  isAdmin,
  robots,
  deleted,
  keepDays,
}: {
  categories: InvCategory[];
  materials: BaseMaterial[];
  bores: BaseMaterial[];
  conditions: Condition[];
  locations: Location[];
  drawerSystems: DrawerSystem[];
  items: { category: string; specs: Record<string, string> }[];
  backups: BackupFile[];
  restoreScopes: ScopeInfo[];
  isAdmin: boolean;
  robots: RobotLayoutsDoc[];
  deleted: DeletedEntry[];
  keepDays: number;
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
      {tab === "categories" && <CategorySettings categories={categories} baseMaterials={materials.map((m) => m.name)} bores={bores.map((b) => b.name)} locations={locations} items={items} />}
      {tab === "materials" && <MaterialsSettings materials={materials} />}
      {tab === "bores" && <BoresSettings bores={bores} />}
      {tab === "map" && <MapSettings places={locations} systems={drawerSystems} />}
      {tab === "conditions" && <ConditionsSettings conditions={conditions} categories={categories} />}
      {tab === "layouts" && <LayoutsDocumentSettings robots={robots} />}
      {tab === "backups" && <BackupsSettings backups={backups} scopes={restoreScopes} isAdmin={isAdmin} />}
      {tab === "deleted" && <RecentlyDeleted entries={deleted} isAdmin={isAdmin} keepDays={keepDays} />}
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
    <Notice tone="error">{result.error}</Notice>
  ) : result.message ? (
    <Notice tone="success">{result.message}</Notice>
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
              onClick={async () => {
                if (await askConfirm({ title: `Remove "${m.name}" from the list?`, body: "Items that have it keep it.", confirm: "Remove", danger: true })) run(() => deleteBaseMaterial(m.id));
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

// ---------- Global Bore list ----------

function BoresSettings({ bores }: { bores: BaseMaterial[] }) {
  const { run, pending, banner } = useRun();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        Shaft bores, like 1/2&quot; Hex or SplineXS. Every field of kind &quot;Global Bore list&quot; in its category&apos;s settings (gears, sprockets, pulleys…) offers all of these, then its own extra bores. Adding or removing one here changes them all; renaming one renames it on every item that has it.
      </p>
      {banner}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {bores.map((b) => (
          <div key={b.id} className="panel flex items-center gap-2 p-2 transition-colors duration-150 hover:border-sky-400/40">
            <InlineName value={b.name} label="Bore name" onSave={(v) => run(() => renameBore(b.id, v))} />
            <SmallButton
              label={`Remove ${b.name}`}
              danger
              onClick={async () => {
                if (await askConfirm({ title: `Remove "${b.name}" from the list?`, body: "Items that have it keep it.", confirm: "Remove", danger: true })) run(() => deleteBore(b.id));
              }}
            >
              ✕
            </SmallButton>
          </div>
        ))}
        {!bores.length && <p className="text-sm text-muted">No bores yet.</p>}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addBore(name), () => setName(""));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Bore, e.g. 1/4" Hex' className="input min-h-11 w-64 max-w-full" />
        <button className="btn min-h-11 active:scale-[0.98]" disabled={pending || !name.trim()}>
          + Add bore
        </button>
      </form>
    </div>
  );
}

// ---------- Conditions ----------

function ConditionsSettings({ conditions, categories }: { conditions: Condition[]; categories: InvCategory[] }) {
  const { run, pending, banner } = useRun();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#22c55e");
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        What state an item is in. The colour marks it on cards and in the table. &ldquo;Only for&rdquo; offers a condition on some categories only; items that already carry it keep it.
      </p>
      {banner}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {conditions.map((c) => (
          <div key={c.id} className="panel flex flex-wrap items-center gap-2 p-2 transition-colors duration-150 hover:border-sky-400/40">
            <ConditionColor color={c.color} label={c.label} onSave={(v) => run(() => updateCondition(c.id, { color: v }))} />
            <InlineName value={c.label} label="Condition name" onSave={(v) => run(() => updateCondition(c.id, { label: v }))} />
            <ConditionScopeButton condition={c} categories={categories} onSave={(onlyFor) => run(() => updateCondition(c.id, { onlyFor }))} />
            <SmallButton
              label={`Delete ${c.label}`}
              danger
              onClick={async () => {
                if (await askConfirm({ title: `Delete the condition "${c.label}"?`, body: "Items keep their stock, without a condition.", confirm: "Delete", danger: true })) run(() => deleteCondition(c.id));
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

// A condition's "Only for" (lib/inventory/variants.ts): category groups and / or categories; none
// ticked = everywhere. A group's tick covers all its categories.
function ConditionScopeButton({ condition, categories, onSave }: { condition: Condition; categories: InvCategory[]; onSave: (v: ConditionScope) => void }) {
  const groups = condition.onlyFor?.groups ?? [];
  const cats = condition.onlyFor?.categories ?? [];
  const names = [...CATEGORY_GROUPS.filter((g) => groups.includes(g.id)).map((g) => g.short), ...categories.filter((c) => cats.includes(c.id)).map((c) => c.label)];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Popover
      hideCaret
      width={300}
      triggerClassName={`press min-h-8 max-w-full truncate rounded-full border px-2.5 text-xs font-semibold active:scale-[0.98] pointer-coarse:min-h-9 ${names.length ? "border-sky-400/50 text-accent" : "border-dashed border-line-strong text-muted"}`}
      trigger={<span title={names.length ? `Only for ${names.join(", ")}` : "Offered everywhere"}>{names.length ? `Only for ${names.join(", ")}` : "Everywhere"}</span>}
    >
      {() => (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-2 text-sm">
          <p className="text-xs text-muted">Offer &ldquo;{condition.label}&rdquo; only on items in:</p>
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.id} className="space-y-1">
              <label className="flex min-h-8 cursor-pointer items-center gap-2 font-semibold">
                <input type="checkbox" checked={groups.includes(g.id)} onChange={() => onSave({ groups: toggle(groups, g.id), categories: cats })} />
                {g.label}
              </label>
              <div className="ml-6 flex flex-wrap gap-x-3">
                {categories
                  .filter((c) => c.group === g.id)
                  .map((c) => (
                    <label key={c.id} className={`flex min-h-8 cursor-pointer items-center gap-1.5 text-xs ${groups.includes(g.id) ? "opacity-50" : ""}`}>
                      <input type="checkbox" checked={cats.includes(c.id) || groups.includes(g.id)} disabled={groups.includes(g.id)} onChange={() => onSave({ groups, categories: toggle(cats, c.id) })} />
                      {c.label}
                    </label>
                  ))}
              </div>
            </div>
          ))}
          {names.length > 0 && (
            <button type="button" className="btn min-h-9 text-xs active:scale-[0.98]" onClick={() => onSave(null)}>
              Offer everywhere
            </button>
          )}
        </div>
      )}
    </Popover>
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
