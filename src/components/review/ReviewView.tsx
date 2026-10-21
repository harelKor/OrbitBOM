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
};

const TYPES: Record<string, string> = { inhouse: "In-house", cots: "COTS", external: "External" };
const ORDER = ["classification", "material", "preProcess", "process1", "process2"];

function shown(field: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (field === "classification") return TYPES[value as string] ?? String(value);
  if (field.startsWith("pre") || field.startsWith("process")) return getMachine(value as string)?.name ?? String(value);
  return String(value);
}

// To Review: one compact card per part that was set up automatically, with what changed and
// why. Approve keeps the change; Reject puts the old values back. Both work in View mode too,
// since reviewing is what the page is for; Suggest setup (the site's rules) is Edit mode only.
export function ReviewView({ robotId, items }: { robotId: string; items: ReviewItem[] }) {
  const edit = useEditMode();
  const { filters } = useFilters();
  const [optimistic, removeOptimistic] = useOptimistic(items, (state, ids: string[]) => state.filter((i) => !ids.includes(i.part.id)));
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ error?: string; message?: string } | null>(null);
  const visible = optimistic.filter((i) => matchesTopBar(i.part, filters));

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
        {visible.length > 1 && (
          <button type="button" onClick={() => decide(visible.map((i) => i.part.id), true)} disabled={pending} className="btn-primary">
            <Icon name="review" />
            Approve all <span className="font-mono tabular-nums">{visible.length}</span>
          </button>
        )}
      </div>

      {note && (
        <div role="status" className={`rounded-md border px-3 py-2 text-sm ${note.error ? "border-rose-300 bg-rose-50 text-rose-700" : "border-line bg-raised text-fg-2"}`}>
          {note.error ?? note.message}
        </div>
      )}

      {visible.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
          {visible.map((item) => (
            <ReviewCard key={item.part.id} item={item} disabled={pending} onDecide={(approve) => decide([item.part.id], approve)} />
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
