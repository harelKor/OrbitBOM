"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import { addCondition, addLocation, deleteCondition, deleteLocation } from "@/app/(app)/inventory/actions";
import type { Condition, Location } from "./types";

type DialogProps = { open: boolean; onClose: () => void };

// The toolbar's Conditions and Locations editors (ref §5).

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
