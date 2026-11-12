"use client";

import { useEffect, useMemo, useState } from "react";
import type { GeometrySketch } from "@/db/schema";

// The Basepart's Geometry (Harel, 2026-11-12): which of the Part Studio's sketches the 3D views
// draw. Tick sketches, or type a name to tick every sketch with it ("Geometry"). The choice goes
// with the form as `sketches` (JSON). Listing them is 1 Onshape call (GET /api/onshape/sketches).
export function GeometryPicker({ studioUrl, initial = [] }: { studioUrl: string; initial?: GeometrySketch[] }) {
  const [all, setAll] = useState<GeometrySketch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(initial.map((s) => s.id)));
  const [name, setName] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/onshape/sketches?url=${encodeURIComponent(studioUrl)}`)
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { sketches?: GeometrySketch[]; error?: string };
        if (cancelled) return;
        if (d.sketches) setAll(d.sketches);
        else setError(d.error ?? "The sketches didn't load.");
      })
      .catch(() => !cancelled && setError("The sketches didn't load."));
    return () => {
      cancelled = true;
    };
  }, [studioUrl]);

  // A sketch chosen earlier and since deleted in Onshape is still listed, so it can be unticked.
  const list = useMemo(() => {
    const got = all ?? [];
    return [...got, ...initial.filter((s) => !got.some((g) => g.id === s.id))];
  }, [all, initial]);
  const value = JSON.stringify(list.filter((s) => chosen.has(s.id)));
  const matches = name.trim() ? list.filter((s) => s.name.toLowerCase().includes(name.trim().toLowerCase())) : [];
  const toggle = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <fieldset className="space-y-2">
      <legend className="label">Geometry sketches</legend>
      <input type="hidden" name="sketches" value={value} />
      <p className="text-xs text-muted">Shown in the 3D views where Onshape draws them; Shift+H shows or hides them.</p>
      {error && <p className="text-amber-700 dark:text-amber-300">{error}</p>}
      {!all && !error && <p className="text-muted">Loading the sketches…</p>}
      {all && !list.length && <p className="text-muted">This Part Studio has no sketches.</p>}
      {list.length > 0 && (
        <>
          <div className="flex gap-2">
            <input className="input min-w-0 flex-1" placeholder="Sketch name, e.g. Geometry" value={name} onChange={(e) => setName(e.target.value)} aria-label="Sketch name" />
            <button
              type="button"
              className="btn shrink-0 active:scale-[0.98]"
              disabled={!matches.length}
              onClick={() => setChosen((c) => new Set([...c, ...matches.map((s) => s.id)]))}
            >
              Tick {matches.length || ""}
            </button>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-2">
            {list.map((s) => (
              <li key={s.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 hover:bg-line/40">
                  <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="truncate">{s.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted tabular-nums">{chosen.size} chosen</p>
        </>
      )}
    </fieldset>
  );
}
