"use client";

import { useState } from "react";
import { isDone } from "@/lib/status";
import {
  MachineField,
  MaterialField,
  NoteField,
  QuantityField,
  slotsOf,
  StatusField,
  TypeField,
  type SaveFn,
} from "./fields";
import { Checkbox } from "@/components/ui/Checkbox";
import { FilesField } from "./FilesField";
import { usePartDetails } from "./PartDetailsHost";
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
    <SheetViewport id="bom">
      <table className="data-table">
        <thead>
          <tr>
            {selection && <th />}
            <th />
            <th className="sheet-name">
              <button onClick={() => setDesc((d) => !d)} className="uppercase hover:text-fg">
                Part name {desc ? "▼" : "▲"}
              </button>
            </th>
            {showSystem && <th>System</th>}
            <th>Type</th>
            <th>Qty</th>
            <th>Material</th>
            <th>Process 1</th>
            <th>Then</th>
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
              <tr key={p.id} id={`part-${p.id}`} data-part={partIds(p)} className={`scroll-mt-20 target:bg-accent/10 ${done ? "bg-emerald-50 dark:bg-emerald-500/10" : ""}`}>
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
                <td className="sheet-name"><PartName part={p} save={save} /></td>
                {showSystem && <td className="text-muted">{p.systemName}</td>}
                <td><TypeField part={p} save={save} /></td>
                <td><QuantityField part={p} save={save} /></td>
                <td><MaterialField part={p} save={save} /></td>
                <td><MachineField part={p} save={save} slot={slotsOf(p)[0]} /></td>
                <td>
                  {/* The added processes after Process 1 (Harel, 2026-11-20). */}
                  <span className="flex flex-wrap items-center gap-1">
                    {slotsOf(p).slice(1).map((s) => (
                      <MachineField key={s.n} part={p} save={save} slot={s} />
                    ))}
                  </span>
                </td>
                <td><StatusField part={p} save={save} /></td>
                <td><FilesField part={p} /></td>
                <td><NoteField part={p} save={save} /></td>
                <td className="whitespace-nowrap text-muted">{p.lastModifiedAt.toISOString().slice(0, 10)}</td>
                <td dir="auto" className="whitespace-nowrap text-muted">{p.lastModifiedByName ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SheetViewport>
  );
}

// The part's name opens its window, the same as a card tap (audit, 2026-11-20); renaming is in
// the window.
function PartName({ part, save }: { part: CardPart; save: SaveFn }) {
  const show = usePartDetails(part, save);
  return (
    <button type="button" dir="auto" onClick={() => show()} className="press text-left font-semibold text-accent-soft hover:underline active:scale-[0.98]">
      {partTitle(part)}
    </button>
  );
}
