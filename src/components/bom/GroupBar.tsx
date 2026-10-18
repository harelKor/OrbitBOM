"use client";

import { useState, useTransition } from "react";
import { addToGroup, createGroup } from "@/app/(app)/groups/actions";

export type GroupTarget = { robotId: string; groups: { id: string; name: string; color: string | null }[] };

// FRCBOM's Group parts bar (ref §3): a new group needs 2+ parts; adding to an existing one, 1+.
export function GroupBar({
  target,
  selected,
  total,
  onSelectAll,
  onDone,
}: {
  target: GroupTarget;
  selected: string[];
  total: number;
  onSelectAll: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [groupId, setGroupId] = useState("");
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (task: () => Promise<{ error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await task();
      setResult(r);
      if (!r.error) {
        setName("");
        onDone();
      }
    });

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{selected.length} selected</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 rounded bg-transparent" aria-label="Group color" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" className="input w-48" />
        <button
          className="btn-primary"
          disabled={pending || selected.length < 2 || !name.trim()}
          title={selected.length < 2 ? "Pick two or more parts" : undefined}
          onClick={() => run(() => createGroup(target.robotId, name, color, selected))}
        >
          Create group
        </button>
        {target.groups.length > 0 && (
          <>
            <span className="text-slate-500">or</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="input w-auto" aria-label="Existing group">
              <option value="">Add to group…</option>
              {target.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={pending || !groupId || !selected.length} onClick={() => run(() => addToGroup(groupId, selected))}>
              Add
            </button>
          </>
        )}
        <button className="btn" onClick={onSelectAll}>
          Select all ({total})
        </button>
        <button className="btn ml-auto" onClick={onDone}>
          Done
        </button>
        {result?.error && <span className="w-full text-rose-300">{result.error}</span>}
      </div>
    </div>
  );
}
