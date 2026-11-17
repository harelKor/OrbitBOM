"use client";

import { useState } from "react";
import { DrawingEditor } from "@/components/drawing/DrawingEditor";
import type { DrawingEdits } from "@/db/schema";
import type { Part } from "@/lib/drawing/read";

// Pick a test part, open its drawing in the real editor. Saves are kept in this tab only.
export function SandboxDrawing({ parts }: { parts: { key: string; part: Part }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, DrawingEdits>>({});
  const pick = parts.find((p) => p.key === open);
  return (
    <main className="space-y-3 p-6">
      <h1 className="text-lg font-semibold">Drawing editor sandbox</h1>
      <div className="flex flex-wrap gap-2">
        {parts.map((p) => (
          <button key={p.key} className="btn" onClick={() => setOpen(p.key)}>
            {p.key}
          </button>
        ))}
      </div>
      {pick && (
        <DrawingEditor
          partId={pick.key}
          onClose={() => setOpen(null)}
          load={async () => ({
            part: pick.part,
            edits: saved[pick.key] ?? {},
            title: { name: `1690-26-421-01 Test ${pick.key}`, material: "6061 Aluminum", processes: ["Router", "Tap"], quantity: 2, system: "Intake", robot: "R26", revision: "V12", date: "2026-11-17" },
            outdated: false,
            others: [],
            fitParts: [],
          })}
          store={async (edits) => setSaved((s) => ({ ...s, [pick.key]: edits }))}
        />
      )}
    </main>
  );
}
