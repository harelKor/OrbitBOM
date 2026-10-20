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
import { partTitle, type CardPart } from "./types";

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
  const th = "px-2 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap";

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            {selection && <th className={th} />}
            <th className={th} />
            <th className={th}>
              <button onClick={() => setDesc((d) => !d)} className="uppercase hover:text-fg">
                Part name {desc ? "▼" : "▲"}
              </button>
            </th>
            {showSystem && <th className={th}>System</th>}
            <th className={th}>Type</th>
            <th className={th}>Qty</th>
            <th className={th}>Material</th>
            {SLOTS.map((s) => (
              <th key={s.key} className={th}>
                {s.label}
              </th>
            ))}
            <th className={th}>Status</th>
            <th className={th}>Files</th>
            <th className={th}>Notes</th>
            <th className={th}>Last edited</th>
            <th className={th}>Edited by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((p) => {
            const save = saveFor(p.id);
            const done = isDone(p);
            return (
              <tr key={p.id} className={done ? "bg-emerald-50" : ""}>
                {selection && (
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={selection.ids.has(p.id)}
                      onChange={() => selection.toggle(p.id)}
                      label={`Select ${partTitle(p)}`}
                    />
                  </td>
                )}
                <td className="py-1 pl-2"><Thumb part={p} /></td>
                <td className="px-2 py-1.5"><NameField part={p} save={save} /></td>
                {showSystem && <td className="px-2 py-1.5 text-muted">{p.systemName}</td>}
                <td className="px-2 py-1.5"><TypeField part={p} save={save} /></td>
                <td className="px-2 py-1.5"><QuantityField part={p} save={save} /></td>
                <td className="px-2 py-1.5"><MaterialField part={p} save={save} /></td>
                {SLOTS.map((s) => (
                  <td key={s.key} className="px-2 py-1.5"><MachineField part={p} save={save} slot={s} /></td>
                ))}
                <td className="px-2 py-1.5"><StatusField part={p} save={save} /></td>
                <td className="px-2 py-1.5"><FilesField part={p} /></td>
                <td className="px-2 py-1.5"><NoteField part={p} save={save} /></td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted">{p.lastModifiedAt.toISOString().slice(0, 10)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted">{p.lastModifiedByName ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
