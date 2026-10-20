"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import { PART_TYPES } from "@/config/partTypes";
import { flattenTree, groupPath } from "@/lib/inventory/groups";
import {
  addCondition,
  addLocation,
  deleteCondition,
  deleteGroup,
  deleteLocation,
  saveGroup,
} from "@/app/(app)/inventory/actions";
import type { Condition, Group, Location, Lookups } from "./types";

type DialogProps = { open: boolean; onClose: () => void };

// The toolbar's Groups, Part types, Conditions and Locations editors (ref §5).

export function GroupsDialog({ open, onClose, lookups: { groups, locations } }: DialogProps & { lookups: Lookups }) {
  const [editing, setEditing] = useState<Group | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reset = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
    setError(null);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Groups" wide>
      <ul className="mb-4 max-h-72 divide-y divide-line overflow-y-auto text-sm">
        {flattenTree(groups).map(({ group, depth }) => (
          <li key={group.id} className="flex items-center gap-2 py-1.5" style={{ paddingLeft: `${depth}rem` }}>
            <span className="flex-1 truncate">{group.name}</span>
            {group.templateId && (
              <span className="text-xs text-subtle">{PART_TYPES.find((t) => t.id === group.templateId)?.name}</span>
            )}
            {group.locationId && (
              <span className="text-xs text-subtle">📍 {locations.find((l) => l.id === group.locationId)?.name}</span>
            )}
            <button
              className="text-xs text-accent-soft hover:text-accent-soft"
              onClick={() => {
                setEditing(group);
                setFormKey((k) => k + 1);
              }}
            >
              Edit
            </button>
            <button
              className="text-xs text-rose-700 hover:text-rose-700"
              onClick={() => {
                if (confirm(`Delete the group "${group.name}"? Its items and sub-groups move up a level.`))
                  startTransition(() => deleteGroup(group.id));
              }}
            >
              Delete
            </button>
          </li>
        ))}
        {groups.length === 0 && <li className="py-2 text-subtle">No groups yet.</li>}
      </ul>

      <form
        key={formKey}
        className="space-y-3 rounded-lg border border-line p-3"
        action={(formData) =>
          startTransition(async () => {
            const result = await saveGroup(editing?.id ?? null, formData);
            if (result.error) setError(result.error);
            else reset();
          })
        }
      >
        <div className="text-sm font-medium">{editing ? `Edit "${editing.name}"` : "New group"}</div>
        <input name="name" required defaultValue={editing?.name ?? ""} placeholder="Group name *" className="input" />
        <div className="grid grid-cols-3 gap-2">
          <select name="parentId" defaultValue={editing?.parentId ?? ""} className="input" aria-label="Parent group">
            <option value="">Top level</option>
            {groups
              .filter((g) => g.id !== editing?.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {groupPath(groups, g.id)}
                </option>
              ))}
          </select>
          <select name="templateId" defaultValue={editing?.templateId ?? ""} className="input" aria-label="Default part type">
            <option value="">No part type</option>
            {PART_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select name="locationId" defaultValue={editing?.locationId ?? ""} className="input" aria-label="Location">
            <option value="">No location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-subtle">Items in a group take its location unless they have their own.</p>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          {editing && (
            <button type="button" className="btn" onClick={reset}>
              Cancel edit
            </button>
          )}
          <button className="btn-primary" disabled={pending}>
            {editing ? "Save group" : "Add group"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function PartTypesDialog({ open, onClose }: DialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Part types" wide>
      <p className="mb-3 text-sm text-muted">
        Part types add detail fields to an item and can build its name. They live in the code
        (<code className="text-xs">src/config/partTypes.ts</code>); ask Claude to change them.
      </p>
      <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto text-sm">
        {PART_TYPES.map((t) => (
          <li key={t.id} className="py-2">
            <div className="font-medium">{t.name}</div>
            <div className="text-xs text-muted">
              {t.fields.map((f) => f.label + (f.options ? ` ▾` : "")).join(" · ")}
              {t.materialSource && <span className="text-subtle"> · material from {t.materialSource}</span>}
            </div>
            {t.namePattern && (
              <div className="text-xs text-subtle">
                Name:{" "}
                {t.namePattern
                  .map((n) =>
                    "field" in n
                      ? `{${t.fields.find((f) => f.id === n.field)?.label}}`
                      : "text" in n
                        ? n.text
                        : "{Material}",
                  )
                  .join("")}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function ConditionsDialog({ open, onClose, conditions }: DialogProps & { conditions: Condition[] }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#22c55e");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onClose={onClose} title="Conditions">
      <ul className="mb-4 divide-y divide-line text-sm">
        {conditions.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1.5">
            <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
            <span className="flex-1">{c.label}</span>
            <button
              className="text-xs text-rose-700 hover:text-rose-700"
              onClick={() => {
                if (confirm(`Delete the condition "${c.label}"? Items keep their stock, without a condition.`))
                  startTransition(() => deleteCondition(c.id));
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await addCondition(label, color);
            setError(r.error ?? null);
            if (!r.error) setLabel("");
          });
        }}
      >
        <input value={color} onChange={(e) => setColor(e.target.value)} type="color" className="h-9 w-10 rounded bg-transparent" aria-label="Color" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New condition" className="input flex-1" />
        <button className="btn-primary" disabled={pending}>
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </Dialog>
  );
}

export function LocationsDialog({ open, onClose, locations }: DialogProps & { locations: Location[] }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onClose={onClose} title="Locations">
      <ul className="mb-4 grid grid-cols-3 gap-2 text-sm">
        {locations.map((l) => (
          <li key={l.id} className="flex items-center justify-between rounded border border-line px-2 py-1">
            <span>{l.name}</span>
            <button
              className="text-xs text-rose-700 hover:text-rose-700"
              aria-label={`Delete ${l.name}`}
              onClick={() => {
                if (confirm(`Delete the location "${l.name}"?`)) startTransition(() => deleteLocation(l.id));
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await addLocation(name);
            setError(r.error ?? null);
            if (!r.error) setName("");
          });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shelf or bin, e.g. A1" className="input flex-1" />
        <button className="btn-primary" disabled={pending}>
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </Dialog>
  );
}
