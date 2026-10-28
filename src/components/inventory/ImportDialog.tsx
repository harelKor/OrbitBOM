"use client";

import { Checkbox } from "@/components/ui/Checkbox";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import {
  IMPORT_COLUMNS,
  guessColumns,
  isOrbitExport,
  parseCsv,
  parseImportRows,
  type ColumnMap,
  type ImportColumn,
} from "@/lib/inventory/import";
import { importItems } from "@/app/(app)/inventory/actions";

const TEMPLATE =
  "Item,Size / spec,Quantity,Location,Category,Condition,Material\n" +
  "Flanged bearing,1/2in hex,12,A1,Bearings > Flanged,New,\n" +
  "Aluminum tube,25x25x1.5,4,B2,Raw stock > Tube,Used,6061\n";

// "Import spreadsheet" (ref §5): pick a file, say which column holds what, check, import.
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [specInName, setSpecInName] = useState(true);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const header = rows?.[0] ?? [];
  const parsed = rows ? parseImportRows(rows.slice(1), map, specInName) : [];

  async function load(file: File) {
    setResult(null);
    try {
      let data: unknown[][];
      if (/\.csv$/i.test(file.name)) {
        data = parseCsv(await file.text());
      } else {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const sheets = await readXlsxFile(file);
        data = (sheets.find((s) => s.sheet.toLowerCase() === "inventory") ?? sheets[0])?.data ?? [];
      }
      if (data.length < 2) throw new Error("The sheet has no rows under the header.");
      setRows(data);
      setMap(guessColumns(data[0]));
      setSpecInName(!isOrbitExport(data[0]));
    } catch (err) {
      setRows(null);
      setResult({ error: `Couldn't read that file: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function close() {
    setRows(null);
    setResult(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} title="Import spreadsheet" wide>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Excel (.xlsx) or .csv. From Google Sheets: File → Download → .xlsx. Tell us which column holds what, check
          the preview, and import. Locations and groups named in the sheet are created; &ldquo;Hardware &gt;
          Bearings&rdquo; makes a sub-group. A row with the same name and category as an item already here updates
          that item instead of adding a copy, so an exported spreadsheet imports back cleanly.{" "}
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="OrbitParts_Inventory_Template.csv"
            className="text-accent-soft hover:text-accent-soft"
          >
            Download the template
          </a>
        </p>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
          className="block text-sm text-fg-2 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-fg"
        />

        {rows && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {IMPORT_COLUMNS.map((c) => (
                <label key={c.id} className="block">
                  <span className="label">
                    {c.label}
                    {"required" in c && " *"}
                  </span>
                  <select
                    value={map[c.id] ?? ""}
                    onChange={(e) =>
                      setMap({ ...map, [c.id as ImportColumn]: e.target.value === "" ? undefined : Number(e.target.value) })
                    }
                    className="input"
                  >
                    <option value="">Not in the sheet</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {String(h ?? `Column ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {map.spec !== undefined && (
              <Checkbox checked={specInName} onChange={setSpecInName}>
                <span className="text-fg-2">Add Size / spec to the item name</span>
              </Checkbox>
            )}

            <div className="max-h-56 overflow-auto rounded-lg border border-line">
              <table className="data-table">
                <thead className="sticky top-0 z-[1]">
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Location</th>
                    <th>Group</th>
                    <th>Condition</th>
                    <th>Material</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td className="font-mono tabular-nums">{r.inStock ?? ""}</td>
                      <td>{r.location}</td>
                      <td>{r.groupPath.join(" › ")}</td>
                      <td>{r.condition}</td>
                      <td>{r.material}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-muted">
              {parsed.length} items to import{parsed.length > 50 && " (showing the first 50)"}.
            </div>
          </>
        )}

        {result?.error && <p className="text-rose-700">{result.error}</p>}
        {result?.message && <p className="text-emerald-700">{result.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={close}>
            {result?.message ? "Close" : "Cancel"}
          </button>
          <button
            className="btn-primary"
            disabled={pending || map.item === undefined || parsed.length === 0 || !!result?.message}
            onClick={() =>
              startTransition(async () => {
                const r = await importItems(parsed);
                setResult(r);
                if (!r.error) setRows(null);
              })
            }
          >
            {pending ? "Importing…" : `Import ${parsed.length || ""} items`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
