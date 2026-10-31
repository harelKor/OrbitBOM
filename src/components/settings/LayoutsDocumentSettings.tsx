"use client";

import { useState, useTransition } from "react";
import { setLayoutsDocument } from "@/app/(app)/robots/actions";

export type RobotLayoutsDoc = { id: string; name: string; year: number; url: string | null };

// Settings → Batch layouts: each robot's Onshape document for its Fab batches' "Batch - <name>"
// assemblies. Without one, Onshape Layout uses the document most of the batch's parts come from.
export function LayoutsDocumentSettings({ robots }: { robots: RobotLayoutsDoc[] }) {
  return (
    <section className="max-w-3xl space-y-4 rounded-xl border border-line bg-surface p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <div>
        <h2 className="display text-xl text-accent">Batch Layouts Document</h2>
        <p className="mt-1 text-sm text-muted">
          Onshape Layout makes each Fab batch&apos;s &quot;Batch - name&quot; assembly in the robot&apos;s Layouts document. Paste a link to any tab of an Onshape document, or open the
          OrbitParts panel in that document and pick &quot;Use this document&quot;. Leave it empty to use the system&apos;s own document.
        </p>
      </div>
      {robots.length === 0 && <p className="text-sm text-subtle">No active robots.</p>}
      <ul className="divide-y divide-line">
        {robots.map((r) => (
          <RobotRow key={r.id} robot={r} />
        ))}
      </ul>
    </section>
  );
}

function RobotRow({ robot }: { robot: RobotLayoutsDoc }) {
  const [link, setLink] = useState(robot.url ?? "");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ error?: string; saved?: boolean } | undefined>();
  const changed = link.trim() !== (robot.url ?? "");
  const save = () => startTransition(async () => setNote(await setLayoutsDocument(robot.id, link)));
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
      <div className="w-40 shrink-0 font-semibold">
        {robot.name} <span className="font-mono text-xs text-subtle tabular-nums">{robot.year}</span>
      </div>
      <input
        value={link}
        onChange={(e) => {
          setLink(e.target.value);
          setNote(undefined);
        }}
        onKeyDown={(e) => e.key === "Enter" && changed && save()}
        placeholder="https://…onshape.com/documents/…"
        aria-label={`${robot.name} Batch Layouts document`}
        className="input min-w-0 flex-1"
      />
      <div className="flex shrink-0 items-center gap-2">
        {robot.url && !changed && (
          <a href={robot.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:underline">
            Open ↗
          </a>
        )}
        <button className="btn-primary press active:scale-[0.98]" disabled={pending || !changed} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {note?.error && <p className="text-xs text-rose-600 sm:basis-full">{note.error}</p>}
      {note?.saved && !pending && <p className="text-xs text-subtle">Saved.</p>}
    </li>
  );
}
