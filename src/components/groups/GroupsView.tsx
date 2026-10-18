"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import { ProgressBar } from "@/components/StatusBar";
import { FileList } from "@/components/bom/FilesField";
import { StatusPill } from "@/components/bom/fields";
import { PRIORITY_COLORS, PRIORITY_OPTIONS, STATUS_OPTIONS, textOn } from "@/components/bom/options";
import { OptionList, Popover } from "@/components/bom/Popover";
import type { GroupSummary } from "@/lib/data/groups";
import {
  deleteGroup,
  recoverMembers,
  removeFromGroup,
  setGroupStatus,
  updateGroup,
} from "@/app/(app)/groups/actions";

type Sort = "name" | "progress" | "priority";
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 } as const;

// The Part Groups page body (ref §1, §6, screenshot 10).
export function GroupsView({ groups, isAdmin }: { groups: GroupSummary[]; isAdmin: boolean }) {
  const [robot, setRobot] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const robots = [...new Map(groups.map((g) => [g.robotId, g.robotName])).entries()];

  const shown = groups
    .filter((g) => !robot || g.robotId === robot)
    .filter((g) => {
      const needle = q.trim().toLowerCase();
      return !needle || [g.name, g.description, ...g.members.map((m) => m.title)].join(" ").toLowerCase().includes(needle);
    })
    .sort((a, b) =>
      sort === "progress"
        ? a.breakdown.percent - b.breakdown.percent
        : sort === "priority"
          ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
          : a.name.localeCompare(b.name),
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select value={robot} onChange={(e) => setRobot(e.target.value)} className="input w-auto">
          <option value="">All robots</option>
          {robots.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups & parts…" className="input max-w-sm flex-1" />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input w-auto" aria-label="Sort">
          <option value="name">Sort: Name</option>
          <option value="progress">Sort: Least done</option>
          <option value="priority">Sort: Priority</option>
        </select>
      </div>
      {groups.length === 0 && (
        <div className="panel p-6 text-sm text-slate-400">
          No groups yet. Open a system&apos;s BOM, click <span className="text-slate-200">Group parts</span>, pick the
          parts and name the group.
        </div>
      )}
      {shown.map((g) => (
        <GroupPanel key={g.id} group={g} isAdmin={isAdmin} />
      ))}
    </div>
  );
}

function GroupPanel({ group, isAdmin }: { group: GroupSummary; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [why, setWhy] = useState(false);
  const run = (task: () => Promise<{ error?: string; message?: string } | void>) =>
    startTransition(async () => {
      const r = await task();
      setMessage(r ? (r.error ?? r.message ?? null) : null);
    });
  const counts = group.breakdown.statuses.filter((s) => s.count > 0);
  const common = counts.length === 1 ? counts[0].name : null;
  const { missing } = group;

  return (
    <section className="panel overflow-hidden" style={{ borderLeft: `4px solid ${group.color ?? "#475569"}` }}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <h2 className="text-lg font-semibold">{group.name}</h2>
        <Link href={`/robots/${group.robotId}`} className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-slate-100">
          {group.robotName}
        </Link>
        <span className="text-sm text-slate-400">
          {group.members.length} part{group.members.length === 1 ? "" : "s"}
        </span>
        {common ? <StatusPill status={common} /> : group.members.length > 0 && <span className="text-xs text-slate-500">Mixed statuses</span>}
        <ProgressBar done={group.breakdown.done} total={group.breakdown.total} />
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <Popover trigger={<span className="btn-primary px-2 py-1">Set status for all</span>} align="right">
            {(close) => (
              <OptionList
                options={STATUS_OPTIONS}
                value={common}
                onPick={(v) => {
                  close();
                  if (v) run(() => setGroupStatus(group.id, v));
                }}
              />
            )}
          </Popover>
          <Popover
            align="right"
            trigger={
              <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: PRIORITY_COLORS[group.priority], color: textOn(PRIORITY_COLORS[group.priority]) }}>
                {group.priority[0].toUpperCase() + group.priority.slice(1)}
              </span>
            }
          >
            {(close) => (
              <OptionList
                options={PRIORITY_OPTIONS}
                value={group.priority}
                onPick={(v) => {
                  close();
                  if (v) run(() => updateGroup(group.id, { priority: v }));
                }}
              />
            )}
          </Popover>
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="btn text-rose-300 hover:text-rose-200"
            onClick={() => confirm(`Delete the group "${group.name}"? The parts stay on the BOM.`) && run(() => deleteGroup(group.id))}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4">
        {group.description && <p className="text-sm text-slate-300">{group.description}</p>}
        {counts.length > 1 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {counts.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 text-slate-400">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name} {s.count}
              </span>
            ))}
          </div>
        )}

        {missing.missing.length > 0 && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-amber-200">
                ⚠ {missing.missing.length} part{missing.missing.length === 1 ? "" : "s"} in this group no longer match
                the BOM.
              </span>
              <button className="text-amber-300 underline hover:text-amber-100" onClick={() => setWhy(true)}>
                Why?
              </button>
              {missing.recoverable > 0 && (
                <button className="text-amber-300 underline hover:text-amber-100" disabled={pending} onClick={() => run(() => recoverMembers(group.id))}>
                  Recover
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {missing.missing.map((m) => (
                <span key={m.partId} className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
                  {m.name} <span className="text-slate-500">({m.systemName})</span>
                  <button className="ml-1 text-slate-500 hover:text-rose-300" aria-label={`Remove ${m.name}`} onClick={() => run(() => removeFromGroup(group.id, m.partId))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 text-xs">
          {group.members.map((m) => (
            <span key={m.partId} className="inline-flex items-center gap-1 rounded border border-slate-800 px-1.5 py-0.5">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_OPTIONS.find((s) => s.value === m.status)?.color }} title={m.status} />
              {m.title}
              <span className="text-slate-500">{m.systemName}</span>
              <button className="text-slate-500 hover:text-rose-300" aria-label={`Remove ${m.title}`} onClick={() => run(() => removeFromGroup(group.id, m.partId))}>
                ✕
              </button>
            </span>
          ))}
        </div>

        <details>
          <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Group files {group.files.length > 0 && `(${group.files.length})`}
          </summary>
          <div className="mt-2 max-w-md">
            <FileList owner={{ kind: "group", id: group.id }} files={group.files} isAdmin={isAdmin} />
          </div>
        </details>
        {message && <p className="text-sm text-slate-300">{message}</p>}
      </div>

      <EditGroupDialog group={group} open={editing} onClose={() => setEditing(false)} />
      <Dialog open={why} onClose={() => setWhy(false)} title="Why these parts stopped matching" wide>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-semibold">{missing.total - missing.missing.length}</span> of {missing.total} members
            still match.
            {missing.allAtOnce &&
              " Every member went at once, which points at a system-wide change (the assembly was re-scanned, re-linked, or its version bumped) rather than parts being removed one by one."}
          </p>
          {missing.recoverable > 0 && (
            <p className="text-emerald-300">{missing.recoverable} can be re-linked automatically with Recover.</p>
          )}
          <ul className="max-h-[50vh] divide-y divide-slate-800 overflow-y-auto">
            {missing.missing.map((m) => (
              <li key={m.partId} className="py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {m.name} <span className="text-slate-500">({m.systemName})</span>
                  </span>
                  <span className={m.reason === "rekeyed" ? "text-amber-300" : "text-rose-300"}>
                    {m.reason === "rekeyed" ? "Re-keyed" : "Removed"}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  {m.reason === "rekeyed"
                    ? `Its identity in Onshape changed, but ${m.liveMatches} row${m.liveMatches === 1 ? "" : "s"} with this name ${m.liveMatches === 1 ? "is" : "are"} still on the BOM.`
                    : "No row with this name is on the BOM any more; the part was deleted or renamed in CAD."}
                  {m.removedFromCadAt && ` Left the BOM ${new Date(m.removedFromCadAt).toISOString().slice(0, 10)}.`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </section>
  );
}

function EditGroupDialog({ group, open, onClose }: { group: GroupSummary; open: boolean; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onClose={onClose} title="Edit group">
      <form
        className="space-y-3"
        action={(fd) =>
          startTransition(async () => {
            const r = await updateGroup(group.id, {
              name: String(fd.get("name")),
              color: String(fd.get("color")),
              description: String(fd.get("description")),
            });
            setError(r.error ?? null);
            if (!r.error) onClose();
          })
        }
      >
        <div className="flex gap-2">
          <input type="color" name="color" defaultValue={group.color ?? "#6366f1"} className="h-9 w-10 rounded bg-transparent" aria-label="Color" />
          <input name="name" required defaultValue={group.name} className="input flex-1" aria-label="Group name" />
        </div>
        <textarea name="description" defaultValue={group.description ?? ""} placeholder="Description" rows={3} className="input" />
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
