"use client";

import { useOptimistic, useState, useTransition } from "react";
import { getMachine } from "@/config/machines";
import { approveParts, rejectParts, suggestSetup } from "@/app/(app)/robots/[robotId]/review/actions";
import { matchesTopBar } from "@/components/bom/filter";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useFilters } from "@/components/shell/FilterContext";
import { useEditMode } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";

export type ReviewItem = {
  part: CardPart;
  source: "rule" | "ai" | "manual";
  reason: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  at: string;
  batchId: string | null;
  memberName: string | null;
};

const TYPES: Record<string, string> = { inhouse: "In-house", cots: "COTS", external: "External" };
const ORDER = ["classification", "material", "preProcess", "process1", "process2"];

function shown(field: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (field === "classification") return TYPES[value as string] ?? String(value);
  if (field.startsWith("pre") || field.startsWith("process")) return getMachine(value as string)?.name ?? String(value);
  return String(value);
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem", hour12: false }).format(new Date(iso));

type Batch = { key: string; label: string; detail: string; items: ReviewItem[] };
type SystemGroup = { id: string; name: string; count: number; batches: Batch[] };

// Waiting parts as big subsystem boxes (by name), each split into the suggestion runs
// (batches, newest first) that touched it.
function groupItems(items: ReviewItem[]): SystemGroup[] {
  const systems = new Map<string, SystemGroup>();
  for (const item of items) {
    let sys = systems.get(item.part.systemId);
    if (!sys) {
      sys = { id: item.part.systemId, name: item.part.systemName, count: 0, batches: [] };
      systems.set(sys.id, sys);
    }
    sys.count++;
    const key = item.batchId ?? "earlier";
    let batch = sys.batches.find((b) => b.key === key);
    if (!batch) {
      batch = {
        key,
        label: item.batchId ? (item.source === "ai" ? "Claude" : "Suggest setup") : "Earlier",
        detail: item.batchId ? `${when(item.at)}${item.memberName ? `, ${item.memberName}` : ""}` : "",
        items: [],
      };
      sys.batches.push(batch);
    }
    batch.items.push(item);
  }
  for (const sys of systems.values()) sys.batches.sort((a, b) => (b.items[0]?.at ?? "").localeCompare(a.items[0]?.at ?? ""));
  return [...systems.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const machinesOf = (p: CardPart) => [p.preProcess, p.process1, p.process2].filter((m): m is string => !!m);

// To Review: compact cards for parts that were set up automatically, with what changed and why.
// Each subsystem is a big box, split into batches (one per suggestion run); inside a batch the
// cards filter by material and machine. Approve keeps the change, Reject puts the old values
// back (also for a whole batch or subsystem). Both work in View mode too, since reviewing is
// what the page is for; Suggest setup (the site's rules) is Edit mode only.
export function ReviewView({ robotId, items }: { robotId: string; items: ReviewItem[] }) {
  const edit = useEditMode();
  const { filters } = useFilters();
  const [optimistic, removeOptimistic] = useOptimistic(items, (state, ids: string[]) => state.filter((i) => !ids.includes(i.part.id)));
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ error?: string; message?: string } | null>(null);

  const matching = optimistic.filter((i) => matchesTopBar(i.part, filters));
  const systems = groupItems(matching);

  const decide = (ids: string[], approve: boolean) => {
    setNote(null);
    startTransition(async () => {
      removeOptimistic(ids);
      const r = approve ? await approveParts(ids) : await rejectParts(ids);
      if (r.error || r.message) setNote(r);
    });
  };
  const suggest = () => {
    setNote(null);
    startTransition(async () => setNote(await suggestSetup(robotId)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm text-muted">
          <span className="font-mono font-semibold text-fg tabular-nums">{optimistic.length}</span> {optimistic.length === 1 ? "part waits" : "parts wait"} for
          their designer
        </div>
        {edit && (
          <button type="button" onClick={suggest} disabled={pending} className="btn" title="Material from Onshape and the 3D model's sizes, processes from what the team usually does">
            <Icon name="gear" />
            Suggest setup
          </button>
        )}
      </div>

      {note && (
        <div role="status" className={`rounded-md border px-3 py-2 text-sm ${note.error ? "border-rose-300 bg-rose-50 text-rose-700" : "border-line bg-raised text-fg-2"}`}>
          {note.error ?? note.message}
        </div>
      )}

      {systems.length ? (
        <div className="space-y-5">
          {systems.map((sys) => (
            <section key={sys.id} aria-label={sys.name} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-lg font-bold text-fg">
                  {sys.name}
                  <span className="ml-2 rounded-full bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg-2 tabular-nums">{sys.count}</span>
                </h2>
                <BulkButtons
                  disabled={pending}
                  count={sys.count}
                  what={`all ${sys.count} ${sys.count === 1 ? "part" : "parts"} in ${sys.name}`}
                  ids={sys.batches.flatMap((b) => b.items.map((i) => i.part.id))}
                  onDecide={decide}
                />
              </div>
              <div className="space-y-4">
                {sys.batches.map((batch) => (
                  <BatchSection key={batch.key} system={sys.name} batch={batch} pending={pending} onDecide={decide} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">
          {optimistic.length ? (
            "No parts match the search."
          ) : (
            <>
              Nothing to review. Parts set up automatically wait here for their designer.
              <div className="mt-2 text-subtle">
                {edit ? "Press Suggest setup, or ask" : "Ask"} your Claude (with the OrbitMech connector) to &ldquo;set up the parts of this robot that have no
                material&rdquo;.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BulkButtons({
  ids,
  count,
  what,
  disabled,
  onDecide,
  filtered,
}: {
  ids: string[];
  count: number;
  what: string;
  disabled: boolean;
  onDecide: (ids: string[], approve: boolean) => void;
  filtered?: boolean;
}) {
  const word = filtered ? "shown" : "all";
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={disabled || !count}
        className="btn-danger"
        onClick={() => confirm(`Reject ${what}? Their material and processes go back to what they were.`) && onDecide(ids, false)}
      >
        Reject {word} <span className="font-mono tabular-nums">{count}</span>
      </button>
      <button type="button" disabled={disabled || !count} className="btn-primary" onClick={() => onDecide(ids, true)}>
        <Icon name="review" />
        Approve {word} <span className="font-mono tabular-nums">{count}</span>
      </button>
    </div>
  );
}

function BatchSection({
  system,
  batch,
  pending,
  onDecide,
}: {
  system: string;
  batch: Batch;
  pending: boolean;
  onDecide: (ids: string[], approve: boolean) => void;
}) {
  const [material, setMaterial] = useState("");
  const [machine, setMachine] = useState("");
  const materials = [...new Set(batch.items.flatMap((i) => (i.part.material ? [i.part.material] : [])))].sort();
  const machines = [...new Set(batch.items.flatMap((i) => machinesOf(i.part)))];
  const visible = batch.items.filter((i) => (!material || i.part.material === material) && (!machine || machinesOf(i.part).includes(machine)));
  const filtered = visible.length !== batch.items.length;
  const what = `${filtered ? "the " : "all "}${visible.length} ${visible.length === 1 ? "part" : "parts"} shown in ${system}, ${batch.label}${batch.detail ? ` (${batch.detail})` : ""}`;

  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-2 min-w-0">
          <span className="font-semibold text-fg">{batch.label}</span>
          {batch.detail && <span className="ml-2 text-xs text-subtle tabular-nums">{batch.detail}</span>}
        </div>
        <select value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material" className="input w-auto">
          <option value="">All materials</option>
          {materials.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine" className="input w-auto">
          <option value="">All machines</option>
          {machines.map((m) => (
            <option key={m} value={m}>
              {getMachine(m)?.name ?? m}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <BulkButtons ids={visible.map((i) => i.part.id)} count={visible.length} what={what} disabled={pending} onDecide={onDecide} filtered={filtered} />
        </div>
      </div>
      {visible.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
          {visible.map((item) => (
            <ReviewCard key={item.part.id} item={item} disabled={pending} onDecide={(approve) => onDecide([item.part.id], approve)} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No parts match these filters.</div>
      )}
    </div>
  );
}

const pill = "max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium";

function ReviewCard({ item, disabled, onDecide }: { item: ReviewItem; disabled: boolean; onDecide: (approve: boolean) => void }) {
  const { part } = item;
  const fields = ORDER.filter((f) => f in item.changes);
  return (
    <div className="card-interactive group flex flex-col text-sm">
      <div className="thumb-well relative flex aspect-[4/3] items-center justify-center">
        {part.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-muted">No thumbnail yet</span>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className="rounded-full bg-[#111318]/85 px-2 py-0.5 font-mono text-[11px] font-bold text-white tabular-nums">×{part.quantity}</span>
          <span className="rounded-full bg-surface/90 px-1.5 py-0.5 text-[10px] font-semibold text-fg-2 shadow-sm">
            {part.classification === "cots" ? "COTS" : "IN-HOUSE"}
          </span>
        </div>
        <span
          className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${item.source === "ai" ? "bg-accent text-white" : "bg-surface/90 text-fg-2 shadow-sm"}`}
          title={item.source === "ai" ? "Set by a member's Claude" : "Set by Suggest setup"}
        >
          {item.source === "ai" ? "AI" : "RULE"}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="min-w-0 flex-1 truncate font-semibold text-fg" title={partTitle(part)}>
            {part.displayName ?? part.onshapeName ?? "Unnamed part"}
          </div>
          {part.partNumber && <span className="shrink-0 font-mono text-[11px] text-subtle">{part.partNumber}</span>}
        </div>

        <ul className="space-y-1">
          {fields.map((f) => {
            const from = shown(f, item.changes[f].from);
            const to = shown(f, item.changes[f].to);
            return (
              <li key={f} className="flex min-w-0 items-center gap-1">
                {from && <span className={`${pill} border-line text-faint line-through`}>{from}</span>}
                {from && <span className="text-[10px] text-faint">→</span>}
                <span className={`${pill} ${to ? "border-accent/60 bg-accent/5 text-accent" : "border-dashed border-line-strong text-subtle"}`}>{to ?? "none"}</span>
              </li>
            );
          })}
        </ul>
        {item.reason && (
          <p className="line-clamp-2 text-xs text-subtle" title={item.reason}>
            {item.reason}
          </p>
        )}

        <div className="mt-auto flex gap-2 pt-1">
          <button type="button" onClick={() => onDecide(true)} disabled={disabled} className="btn-primary flex-1 justify-center">
            Approve
          </button>
          <button type="button" onClick={() => onDecide(false)} disabled={disabled} className="btn flex-1 justify-center">
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
