"use client";

import { useState } from "react";
import { isDone } from "@/lib/status";
import {
  MachineField,
  MaterialField,
  NameField,
  NoteField,
  QuantityField,
  SLOTS,
  StatusField,
  TypeField,
  type SaveFn,
} from "./fields";
import { Checkbox } from "@/components/ui/Checkbox";
import { FilesField } from "./FilesField";
import { Thumb } from "./Thumb";
import { partIds, partTitle, type CardPart } from "./types";
import { SheetViewport } from "@/components/ui/SheetViewport";

// FRCBOM's table (ref §3): the same popover editors in the cells. Order-mode columns are off.
export function TableView({
  parts,
  saveFor,
  showSystem,
  selection,
}: {
  parts: CardPart[];
  saveFor: (id: string) => SaveFn;
  showSystem: boolean;
  selection?: { ids: Set<string>; toggle: (id: string) => void };
}) {
  const [desc, setDesc] = useState(false);
  const sorted = [...parts].sort((a, b) => partTitle(a).localeCompare(partTitle(b), undefined, { numeric: true }) * (desc ? -1 : 1));

  return (
    <SheetViewport id="bom" pin={selection ? 3 : 2}>
      <table className="data-table">
        <thead>
          <tr>
            {selection && <th />}
            <th />
            <th>
              <button onClick={() => setDesc((d) => !d)} className="uppercase hover:text-fg">
                Part name {desc ? "▼" : "▲"}
              </button>
            </th>
            {showSystem && <th>System</th>}
            <th>Type</th>
            <th>Qty</th>
            <th>Material</th>
            {SLOTS.map((s) => (
              <th key={s.key}>
                {s.label}
              </th>
            ))}
            <th>Status</th>
            <th>Files</th>
            <th>Notes</th>
            <th>Last edited</th>
            <th>Edited by</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const save = saveFor(p.id);
            const done = isDone(p);
            return (
              <tr key={p.id} id={`part-${p.id}`} data-part={partIds(p)} className={`scroll-mt-20 target:bg-accent/10 ${done ? "bg-emerald-50" : ""}`}>
                {selection && (
                  <td>
                    <Checkbox
                      checked={selection.ids.has(p.id)}
                      onChange={() => selection.toggle(p.id)}
                      label={`Select ${partTitle(p)}`}
                    />
                  </td>
                )}
                <td><Thumb part={p} size={44} /></td>
                <td><NameField part={p} save={save} /></td>
                {showSystem && <td className="text-muted">{p.systemName}</td>}
                <td><TypeField part={p} save={save} /></td>
                <td><QuantityField part={p} save={save} /></td>
                <td><MaterialField part={p} save={save} /></td>
                {SLOTS.map((s) => (
                  <td key={s.key}><MachineField part={p} save={save} slot={s} /></td>
                ))}
                <td><StatusField part={p} save={save} /></td>
                <td><FilesField part={p} /></td>
                <td><NoteField part={p} save={save} /></td>
                <td className="whitespace-nowrap text-muted">{p.lastModifiedAt.toISOString().slice(0, 10)}</td>
                <td className="whitespace-nowrap text-muted">{p.lastModifiedByName ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SheetViewport>
  );
}
