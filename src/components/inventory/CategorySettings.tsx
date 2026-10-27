"use client";

import { useRef, useState, useTransition } from "react";
import { addCategory, deleteCategory, moveCategory, saveCategory } from "@/app/(app)/inventory/actions";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { MATERIALS } from "@/config/materials";
import { Icon } from "@/components/ui/Icon";
import type { CategoryField } from "@/lib/inventory/categories";
import type { InvCategory, Item, Location } from "./types";

const KINDS: { id: CategoryField["kind"]; label: string }[] = [
  { id: "number", label: "Number" },
  { id: "text", label: "Text" },
  { id: "options", label: "Options" },
  { id: "material", label: "BOM material" },
];

// Category settings (Harel, 2026-10-23): a panel that slides in over Inventory. Each change saves
// by itself a moment later; there is no Save button and nothing jumps. A field that items use can
// be hidden but not deleted, so their values aren't lost.
export function CategorySettings({ open, onClose, categories, locations, items }: { open: boolean; onClose: () => void; categories: InvCategory[]; locations: Location[]; items: Item[] }) {
  const [selected, setSelected] = useState<string | null>(categories[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, InvCategory>>({});
  const [status, setStatus] = useState<{ error?: string; saving?: boolean; saved?: boolean }>({});
  const [newName, setNewName] = useState("");
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cat = selected ? (drafts[selected] ?? categories.find((c) => c.id === selected)) : undefined;
  const used = (fieldId: string) => !!cat && items.some((i) => i.category === cat.id && i.specs[fieldId]);

  const change = (next: InvCategory) => {
    setDrafts((d) => ({ ...d, [next.id]: next }));
    setStatus({ saving: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        startTransition(async () => {
          const r = await saveCategory(next);
          setStatus(r.error ? { error: r.error } : { saved: true });
        }),
      600,
    );
  };
  const setField = (i: number, f: Partial<CategoryField>) => cat && change({ ...cat, fields: cat.fields.map((x, j) => (j === i ? { ...x, ...f } : x)) });
  const moveField = (i: number, by: number) => {
    if (!cat || i + by < 0 || i + by >= cat.fields.length) return;
    const fields = [...cat.fields];
    [fields[i], fields[i + by]] = [fields[i + by], fields[i]];
    change({ ...cat, fields });
  };
  // Drag a field by its ⠿ handle onto another field to put it there.
  const [drag, setDrag] = useState<{ from: number; armed: boolean; over: number | null } | null>(null);
  const dropField = (to: number) => {
    if (!cat || !drag || drag.from === to) return setDrag(null);
    const fields = [...cat.fields];
    const [moved] = fields.splice(drag.from, 1);
    fields.splice(to, 0, moved);
    change({ ...cat, fields });
    setDrag(null);
  };
  const run = (fn: () => Promise<{ error?: string; id?: string }>, then?: (id?: string) => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.error) setStatus({ error: r.error });
      else then?.(r.id);
    });

  return (
    <>
      {open && <button aria-label="Close settings" onClick={onClose} className="modal-backdrop fixed inset-0 z-[65]" />}
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-[70] flex w-[min(40rem,100vw)] flex-col border-l border-[color-mix(in_oklab,var(--color-accent)_38%,var(--color-line-strong))] bg-raised shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
      >
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <Icon name="gear" className="h-5 w-5 text-accent" />
          <h2 className="display flex-1 text-2xl text-accent">Category settings</h2>
          <span className="text-xs text-muted">{status.error ? <span className="text-rose-600">{status.error}</span> : status.saving ? "Saving…" : status.saved ? "Saved" : ""}</span>
          <button type="button" onClick={onClose} className="press flex h-10 w-10 items-center justify-center rounded-lg hover:bg-raised" aria-label="Close">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                className={`press min-h-10 rounded-full border px-3.5 text-sm font-semibold ${c.id === selected ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-accent"}`}
              >
                {(drafts[c.id] ?? c).label}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => addCategory(newName),
                  (id) => {
                    setNewName("");
                    if (id) setSelected(id);
                  },
                );
              }}
              className="flex gap-1"
            >
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" className="input min-h-10 w-36" />
              <button className="btn min-h-10" disabled={!newName.trim()}>
                Add
              </button>
            </form>
          </div>

          {cat && (
            <div className="panel space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="label">Name</span>
                  <input value={cat.label} onChange={(e) => change({ ...cat, label: e.target.value })} className="input min-h-11" />
                </label>
                <label>
                  <span className="label">Ends the item name</span>
                  <input value={cat.noun} onChange={(e) => change({ ...cat, noun: e.target.value })} placeholder="e.g. Pulley" className="input min-h-11" />
                </label>
                <label>
                  <span className="label">Group</span>
                  <select value={cat.group} onChange={(e) => change({ ...cat, group: e.target.value as InvCategory["group"] })} className="input min-h-11">
                    {CATEGORY_GROUPS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">Location for new items</span>
                  <select value={cat.defaultLocationId ?? ""} onChange={(e) => change({ ...cat, defaultLocationId: e.target.value || null })} className="input min-h-11">
                    <option value="">Where most of its items are</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={cat.sheet} onChange={(e) => change({ ...cat, sheet: e.target.checked })} className="h-5 w-5" />
                  Counted in sheets and pieces (¼ ⅓ ½)
                </label>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold tracking-wide text-subtle uppercase">Fields</div>
                {cat.fields.map((f, i) => (
                  <div
                    key={f.id}
                    draggable={drag?.from === i && drag.armed}
                    onDragStart={(e) => (e.dataTransfer.effectAllowed = "move")}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      if (drag.over !== i) setDrag({ ...drag, over: i });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropField(i);
                    }}
                    onDragEnd={() => setDrag(null)}
                    className={`space-y-2 rounded-xl border bg-surface p-3 ${f.hidden ? "opacity-60" : ""} ${drag?.over === i && drag.from !== i ? "border-accent" : "border-line"} ${drag?.from === i && drag.over !== null ? "opacity-50" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        onPointerDown={() => setDrag({ from: i, armed: true, over: null })}
                        onPointerUp={() => setDrag((d) => (d && d.over === null ? null : d))}
                        className="cursor-grab px-1 text-lg leading-none text-subtle select-none hover:text-fg active:cursor-grabbing"
                        title="Drag to reorder"
                        aria-hidden
                      >
                        ⠿
                      </span>
                      <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} aria-label="Field name" className="input min-h-10 w-40 flex-1 font-semibold" />
                      <select value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as CategoryField["kind"] })} aria-label="Kind" className="input min-h-10 w-auto">
                        {KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={f.name ?? "{}"}
                        onChange={(e) => setField(i, { name: e.target.value })}
                        aria-label="In the name as"
                        title='How the value goes into the item name; {} is the value ("{}T" makes 36T). Empty leaves it out.'
                        className="input min-h-10 w-24 font-mono text-xs"
                      />
                      <IconButton label="Move up" onClick={() => moveField(i, -1)} disabled={i === 0}>
                        ↑
                      </IconButton>
                      <IconButton label="Move down" onClick={() => moveField(i, 1)} disabled={i === cat.fields.length - 1}>
                        ↓
                      </IconButton>
                      <IconButton label={f.hidden ? "Show" : "Hide"} onClick={() => setField(i, { hidden: !f.hidden })}>
                        {f.hidden ? "Show" : "Hide"}
                      </IconButton>
                      <IconButton label="Delete field" disabled={used(f.id)} title={used(f.id) ? "Items use this field; hide it instead" : "Delete field"} onClick={() => change({ ...cat, fields: cat.fields.filter((_, j) => j !== i) })}>
                        ✕
                      </IconButton>
                    </div>
                    {f.kind === "options" && <OptionsEditor options={f.options ?? []} onChange={(options) => setField(i, { options })} />}
                    {f.kind === "material" && (
                      <div>
                        <div className="mb-1 text-xs text-muted">From the BOM&apos;s materials:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.keys(MATERIALS)
                            .filter((g) => MATERIALS[g].length)
                            .map((g) => {
                              const on = f.materials?.includes(g);
                              return (
                                <button
                                  key={g}
                                  type="button"
                                  onClick={() => setField(i, { materials: on ? f.materials!.filter((x) => x !== g) : [...(f.materials ?? []), g] })}
                                  className={`press min-h-9 rounded-full border px-3 text-xs font-semibold ${on ? "border-accent bg-accent text-white" : "border-line-strong text-fg-2"}`}
                                >
                                  {g}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn min-h-11"
                  onClick={() => {
                    let id = "field";
                    for (let n = 2; cat.fields.some((f) => f.id === id); n++) id = `field-${n}`;
                    change({ ...cat, fields: [...cat.fields, { id, label: "New field", kind: "text" }] });
                  }}
                >
                  + Add field
                </button>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                <button type="button" className="btn min-h-10" onClick={() => run(() => moveCategory(cat.id, -1))}>
                  ↑ Earlier in the list
                </button>
                <button type="button" className="btn min-h-10" onClick={() => run(() => moveCategory(cat.id, 1))}>
                  ↓ Later
                </button>
                <button
                  type="button"
                  className="btn ml-auto min-h-10 text-rose-700"
                  onClick={() => {
                    if (!confirm(`Delete the category "${cat.label}"?`)) return;
                    run(() => deleteCategory(cat.id), () => setSelected(categories.find((c) => c.id !== cat.id)?.id ?? null));
                  }}
                >
                  Delete category
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function IconButton({ label, title, onClick, disabled, children }: { label: string; title?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={title ?? label} onClick={onClick} disabled={disabled} className="press min-h-10 min-w-10 rounded-lg border border-line px-2 text-sm text-fg-2 hover:bg-raised disabled:opacity-30">
      {children}
    </button>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (v && !options.includes(v)) onChange([...options, v]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <span key={o} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong bg-raised pr-1 pl-3 text-xs font-semibold">
          {o}
          <button type="button" onClick={() => onChange(options.filter((x) => x !== o))} className="press flex h-7 w-7 items-center justify-center rounded-full text-subtle hover:bg-line hover:text-rose-600" aria-label={`Remove ${o}`}>
            ✕
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="Add option ⏎"
        className="input min-h-9 w-32 text-xs"
      />
      <span className="text-[11px] text-subtle">{options.length > 6 ? "shown as a dropdown" : "shown as chips"}</span>
    </div>
  );
}

