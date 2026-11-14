"use client";

import { useEffect, useState, useTransition } from "react";
import { getMachine } from "@/config/machines";
import {
  approveInventory,
  approveParts,
  dismissInventory,
  dismissParts,
  rejectInventory,
  rejectParts,
  suggestSetup,
  type ActionResult,
} from "@/app/(app)/robots/[robotId]/review/actions";
import { updatePart } from "@/app/(app)/parts-actions";
import { isCardBodyClick } from "@/components/bom/PartCard";
import { OptionList, Popover } from "@/components/bom/Popover";
import { usePartDetails } from "@/components/bom/PartDetailsHost";
import type { PartChanges } from "@/lib/parts/changes";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { matchesTopBar } from "@/components/bom/filter";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useFilters } from "@/components/shell/FilterContext";
import { useCan } from "@/components/shell/ModeContext";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { statusTint } from "@/components/ui/statusTint";
import { computeStatus } from "@/lib/status";
import type { InventoryReview } from "@/lib/review/inventory";
import { Notice } from "@/components/ui/Notice";
import { askConfirm } from "@/components/ui/useConfirm";
import { toast } from "@/components/ui/Toaster";

export type ReviewItem = {
  part: CardPart;
  source: "rule" | "ai" | "manual";
  reason: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  pending?: string[]; // fields in changes that aren't applied until Approve (an inventory link)
  at: string;
  batchId: string | null;
  memberName: string | null;
  aiName: string | null;
};

const TYPES: Record<string, string> = { inhouse: "In-house", cots: "COTS", external: "External", undefined: "Undefined" };
const ORDER = ["classification", "material", "preProcess", "process1", "process2", "displayName", "cotsLinks", "unitPrice", "cotsCategory", "description", "priority", "deadline", "designerName", "note", "inventoryItemId"];
const LABELS: Record<string, string> = {
  displayName: "Name",
  cotsLinks: "Links",
  unitPrice: "Price",
  cotsCategory: "Category",
  description: "Description",
  priority: "Priority",
  deadline: "Deadline",
  designerName: "Designer",
  note: "Note",
  inventoryItemId: "Inventory",
};

function shown(field: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (field === "classification") return TYPES[value as string] ?? String(value);
  if (field.startsWith("pre") || field.startsWith("process")) return getMachine(value as string)?.name ?? String(value);
  if (field === "cotsLinks") return Array.isArray(value) && value.length ? `${value.length} ${value.length === 1 ? "link" : "links"}` : null;
  if (field === "unitPrice") return `$${value}`;
  return String(value);
}

// The site suggested an inventory item for the part (auto-link).
const autoLinked = (item: Pick<ReviewItem, "source" | "changes">) => item.source === "rule" && Object.keys(item.changes).every((f) => f === "inventoryItemId");

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
        label: item.batchId ? (item.source === "ai" ? (item.aiName ?? "Claude") : autoLinked(item) ? "Auto-link" : "Suggest setup") : "Earlier",
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

// Ids decided in this tab. Kept outside the component so a decided card can't come back while
// the server catches up, even if the page remounts; an id leaves only when the server no longer
// lists it, or when the decision failed.
const decidedParts = new Set<string>();
const decidedInventory = new Set<string>();

// Hides decided ids at once and sends the decision; on a failure they come back with the error.
function useDecisions(decided: Set<string>, listed: string[], send: (ids: string[], approve: Decision) => Promise<ActionResult>, onNote: (n: ActionResult | null) => void) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set(listed.filter((id) => decided.has(id))));
  const [, startDecide] = useTransition(); // decisions don't lock the other buttons
  // New props: forget the ids the server no longer lists (adjusting state while rendering).
  const key = listed.join(",");
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    const now = new Set(listed);
    if ([...gone].some((id) => !now.has(id))) setGone(new Set([...gone].filter((id) => now.has(id))));
  }
  useEffect(() => {
    const now = new Set(key ? key.split(",") : []);
    for (const id of decided) if (!now.has(id) && !gone.has(id)) decided.delete(id);
  }, [decided, key, gone]);
  const restore = (ids: string[]) => {
    for (const id of ids) decided.delete(id);
    setGone((g) => new Set([...g].filter((id) => !ids.includes(id))));
  };
  const decide = (ids: string[], approve: Decision) => {
    onNote(null);
    for (const id of ids) decided.add(id);
    setGone((g) => new Set([...g, ...ids]));
    startDecide(async () => {
      try {
        const r = await send(ids, approve);
        if (r.error) restore(ids);
        if (r.error || r.message) onNote(r);
      } catch {
        restore(ids);
        onNote({ error: "That didn't go through. Try again." });
      }
    });
  };
  return { gone, decide };
}

// true approves, false rejects; "dismiss" (the card's X) only takes the request off To Review.
type Decision = boolean | "dismiss";

const machinesOf = (p: CardPart) => [p.preProcess, p.process1, p.process2].filter((m): m is string => !!m);

// To Review: compact cards for parts that were set up automatically, with what changed and why.
// Each subsystem is a big box, split into batches (one per suggestion run) that fold from their
// title; inside a batch the cards filter by material and machine. Approve keeps the change, Reject
// puts the old values back (also for a whole batch or subsystem). Both work in View mode too,
// since reviewing is what the page is for; Suggest setup (the site's rules) is Edit mode only, and
// runs on the whole robot or one subsystem picked from its menu.
export function ReviewView({
  robotId,
  systems: robotSystems,
  items,
  inventory,
}: {
  robotId: string;
  systems: { id: string; name: string }[];
  items: ReviewItem[];
  inventory: InventoryReview[];
}) {
  // The CAD Team (and Edit) reviews; everyone else sees what waits here, read only.
  const edit = useCan("review");
  const { filters } = useFilters();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<ActionResult | null>(null);
  // Decided parts disappear the moment they are clicked; the action revalidates the page before
  // it returns, and they stay hidden until the new props leave them out.
  const parts = useDecisions(
    decidedParts,
    items.map((i) => i.part.id),
    (ids, approve) => (approve === "dismiss" ? dismissParts(ids) : approve ? approveParts(ids) : rejectParts(ids)),
    setNote,
  );
  const inv = useDecisions(
    decidedInventory,
    inventory.map((i) => i.id),
    (ids, approve) => (approve === "dismiss" ? dismissInventory(ids) : approve ? approveInventory(ids) : rejectInventory(ids)),
    setNote,
  );
  const decide = parts.decide;
  const optimistic = items.filter((i) => !parts.gone.has(i.part.id));
  const inventoryLeft = inventory.filter((i) => !inv.gone.has(i.id));

  const matching = optimistic.filter((i) => matchesTopBar(i.part, filters));
  const systems = groupItems(matching);
  const suggest = (systemId?: string) => {
    setNote(null);
    startTransition(async () => setNote(await suggestSetup(robotId, systemId)));
  };
  const ALL = "all";
  const suggestOptions = [
    { value: ALL, label: "All systems" },
    ...[...robotSystems].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name, group: "Subsystem" })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm text-muted">
          <span className="font-mono font-semibold text-fg tabular-nums">{optimistic.length}</span> {optimistic.length === 1 ? "part waits" : "parts wait"} for
          their designer
          {inventoryLeft.length > 0 && (
            <>
              , <span className="font-mono font-semibold text-fg tabular-nums">{inventoryLeft.length}</span> inventory{" "}
              {inventoryLeft.length === 1 ? "change" : "changes"}
            </>
          )}
        </div>
        {edit && (
          <Popover
            align="right"
            triggerClassName={`btn ${pending ? "pointer-events-none opacity-60" : ""}`}
            trigger={
              <span className="inline-flex items-center gap-1.5" title="Material from Onshape and the 3D model's sizes, processes from what the team usually does">
                <Icon name="gear" />
                {pending ? "Setting up…" : "Suggest setup"}
              </span>
            }
          >
            {(close) => (
              <OptionList
                options={suggestOptions}
                value={null}
                placeholder="Run on…"
                onPick={(v) => {
                  close();
                  suggest(v && v !== ALL ? v : undefined);
                }}
              />
            )}
          </Popover>
        )}
      </div>

      {note && (
        <Notice tone={note.error ? "error" : "info"}>{note.error ?? note.message}</Notice>
      )}

      {inventoryLeft.length > 0 && <InventorySection reviews={inventoryLeft} onDecide={inv.decide} />}

      {systems.length ? (
        <div className="space-y-5">
          {systems.map((sys) => (
            <details key={sys.id} aria-label={sys.name} className="group rounded-xl border border-line bg-surface p-4 shadow-sm">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                <h2 className="mr-auto flex items-center gap-2 text-lg font-bold text-fg">
                  <span aria-hidden className="inline-block text-sm text-muted transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  {sys.name}
                  <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg-2 tabular-nums">{sys.count}</span>
                </h2>
                <BulkButtons
                  disabled={pending}
                  count={sys.count}
                  what={`all ${sys.count} ${sys.count === 1 ? "part" : "parts"} in ${sys.name}`}
                  ids={sys.batches.flatMap((b) => b.items.map((i) => i.part.id))}
                  onDecide={decide}
                />
              </summary>
              <div className="mt-3 space-y-4">
                {sys.batches.map((batch) => (
                  <BatchSection key={batch.key} system={sys.name} batch={batch} pending={pending} onDecide={decide} />
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : inventoryLeft.length ? null : (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">
          {optimistic.length ? (
            "No parts match the search."
          ) : (
            <>
              Nothing to review. Parts set up automatically wait here for their designer.
              <div className="mt-2 text-subtle">
                {edit ? "Press Suggest setup, or ask" : "Ask"} your Claude (with the OrbitParts connector) to &ldquo;set up the parts of this robot that have no
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
  undoes = "Their material and processes go back to what they were.",
}: {
  ids: string[];
  count: number;
  what: string;
  disabled: boolean;
  onDecide: (ids: string[], approve: Decision) => void;
  filtered?: boolean;
  undoes?: string;
}) {
  const canReview = useCan("review");
  const word = filtered ? "shown" : "all";
  if (!canReview) return null;
  return (
    // Inside a <summary>: keep a click on the buttons from folding the box.
    <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
      <button
        type="button"
        disabled={disabled || !count}
        className="btn-danger"
        onClick={async () => {
          if (await askConfirm({ title: `Reject ${what}?`, body: undoes, confirm: "Reject", danger: true })) onDecide(ids, false);
        }}
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
  onDecide: (ids: string[], approve: Decision) => void;
}) {
  const [open, setOpen] = useState(true);
  const [material, setMaterial] = useState("");
  const [machine, setMachine] = useState("");
  const materials = [...new Set(batch.items.flatMap((i) => (i.part.material ? [i.part.material] : [])))].sort();
  const machines = [...new Set(batch.items.flatMap((i) => machinesOf(i.part)))];
  const visible = batch.items.filter((i) => (!material || i.part.material === material) && (!machine || machinesOf(i.part).includes(machine)));
  const filtered = visible.length !== batch.items.length;
  const what = `${filtered ? "the " : "all "}${visible.length} ${visible.length === 1 ? "part" : "parts"} shown in ${system}, ${batch.label}${batch.detail ? ` (${batch.detail})` : ""}`;

  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className={`flex flex-wrap items-center gap-2 ${open ? "mb-3" : ""}`}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mr-2 flex min-w-0 items-center gap-2 text-left">
          <Chevron open={open} small />
          <span className="font-semibold text-fg">{batch.label}</span>
          {batch.detail && <span className="text-xs text-subtle tabular-nums">{batch.detail}</span>}
          {!open && <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg-2 tabular-nums">{batch.items.length}</span>}
        </button>
        {open && (
          <>
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
          </>
        )}
        <div className="ml-auto">
          <BulkButtons ids={visible.map((i) => i.part.id)} count={visible.length} what={what} disabled={pending} onDecide={onDecide} filtered={filtered} />
        </div>
      </div>
      {!open ? null : visible.length ? (
        <div className="card-grid [--card-min:260px]">
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

const pill = "max-w-full truncate rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium";

// The card's X: takes the request off To Review, neither approving nor rejecting it.
function DismissButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  if (!useCan("review")) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Remove from AI review"
      title="Remove from AI review (keep things as they are now, without approving or rejecting)"
      className="press -mr-1 shrink-0 rounded p-1 text-subtle hover:bg-raised hover:text-fg active:scale-[0.98]"
    >
      <Icon name="close" className="h-3.5 w-3.5" />
    </button>
  );
}

// A click anywhere but its buttons opens the part's details window, as it is now (with the change).
function ReviewCard({ item, disabled, onDecide }: { item: ReviewItem; disabled: boolean; onDecide: (approve: Decision) => void }) {
  const canReview = useCan("review");
  const { part } = item;
  const fields = ORDER.filter((f) => f in item.changes);
  const [, startSave] = useTransition();
  const save = (changes: PartChanges) =>
    startSave(async () => {
      const r = await updatePart(part.id, changes);
      if (r.error) toast(r.error, true);
    });
  const showDetails = usePartDetails(part, save);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => isCardBodyClick(e) && showDetails()}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && showDetails()}
      aria-label={`Open ${partTitle(part)}`}
      className="card-interactive group flex cursor-pointer flex-col text-sm"
      style={statusTint(computeStatus(part))}
    >
      <div className={`thumb-well ${part.classification === "cots" ? "thumb-cots" : "thumb-made"} relative flex aspect-[4/3] items-center justify-center`}>
        {part.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-muted">No thumbnail yet</span>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className="rounded-full bg-[#111318]/85 px-2 py-0.5 font-mono text-[0.6875rem] font-bold text-white tabular-nums">×{part.quantity}</span>
          <span className="rounded-full bg-surface/90 px-1.5 py-0.5 text-[0.625rem] font-semibold text-fg-2 shadow-sm">
            {part.classification === "cots" ? "COTS" : "IN-HOUSE"}
          </span>
        </div>
        <span
          className={`absolute top-2 right-2 max-w-[60%] truncate rounded-full px-2 py-0.5 text-[0.625rem] font-bold tracking-wide ${item.source === "ai" ? "bg-accent text-white" : "bg-surface/90 text-fg-2 shadow-sm"}`}
          title={item.source === "ai" ? `Set by ${item.aiName ?? "a member's Claude"}` : autoLinked(item) ? "Inventory link suggested by the site; Approve links it" : "Set by Suggest setup"}
        >
          {item.source === "ai" ? (item.aiName ?? "AI") : autoLinked(item) ? "AUTO-LINK" : "RULE"}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-semibold text-fg" title={partTitle(part)}>
            {part.displayName ?? part.onshapeName ?? "Unnamed part"}
          </div>
          <DismissButton onClick={() => onDecide("dismiss")} disabled={disabled} />
        </div>

        <ul className="space-y-1">
          {fields.map((f) => {
            const from = shown(f, item.changes[f].from);
            const to = shown(f, item.changes[f].to);
            return (
              <li key={f} className="flex min-w-0 items-center gap-1">
                {LABELS[f] && <span className="shrink-0 text-[0.625rem] font-semibold text-subtle uppercase">{LABELS[f]}</span>}
                {from && <span className={`${pill} border-line text-faint line-through`}>{from}</span>}
                {from && <span className="text-[0.625rem] text-faint">→</span>}
                <span className={`${pill} ${to ? "border-accent/60 bg-accent/5 text-accent" : "border-dashed border-line-strong text-subtle"}`}>{to ?? "none"}</span>
                {item.pending?.includes(f) && <span className="shrink-0 text-[0.625rem] text-subtle">· on Approve</span>}
              </li>
            );
          })}
        </ul>
        {item.reason && (
          <p className="line-clamp-2 text-xs text-subtle" title={item.reason}>
            {item.reason}
          </p>
        )}

        {canReview && <div className="mt-auto flex gap-2 pt-1">
          <button type="button" onClick={() => onDecide(true)} disabled={disabled} className="btn-primary flex-1 justify-center">
            Approve
          </button>
          <button type="button" onClick={() => onDecide(false)} disabled={disabled} className="btn flex-1 justify-center">
            Reject
          </button>
        </div>}
      </div>
    </div>
  );
}

const INVENTORY_UNDO = "Items get their old values back and new categories are removed.";

// To Review's Inventory box: a Claude's edits to existing items and the categories it added,
// split by category. Approve keeps a change (it is already applied); Reject puts it back.
function InventorySection({ reviews, onDecide }: { reviews: InventoryReview[]; onDecide: (ids: string[], approve: Decision) => void }) {
  const groups = new Map<string, { label: string; reviews: InventoryReview[] }>();
  for (const r of reviews) {
    const g = groups.get(r.categoryId) ?? { label: r.categoryLabel, reviews: [] };
    g.reviews.push(r);
    groups.set(r.categoryId, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  const n = reviews.length;
  return (
    <details open aria-label="Inventory" className="group rounded-xl border border-line bg-surface p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
        <h2 className="mr-auto flex items-center gap-2 text-lg font-bold text-fg">
          <span aria-hidden className="inline-block text-sm text-muted transition-transform group-open:rotate-90">
            ▸
          </span>
          Inventory
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg-2 tabular-nums">{n}</span>
        </h2>
        <BulkButtons
          disabled={false}
          count={n}
          what={`all ${n} inventory ${n === 1 ? "change" : "changes"}`}
          ids={reviews.map((r) => r.id)}
          onDecide={onDecide}
          undoes={INVENTORY_UNDO}
        />
      </summary>
      <div className="mt-3 space-y-4">
        {sorted.map(([id, g]) => (
          <InventoryCategory key={id} label={g.label} reviews={g.reviews} onDecide={onDecide} />
        ))}
      </div>
    </details>
  );
}

function InventoryCategory({ label, reviews, onDecide }: { label: string; reviews: InventoryReview[]; onDecide: (ids: string[], approve: Decision) => void }) {
  const [open, setOpen] = useState(true);
  const n = reviews.length;
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className={`flex flex-wrap items-center gap-2 ${open ? "mb-3" : ""}`}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mr-auto flex min-w-0 items-center gap-2 text-left">
          <Chevron open={open} small />
          <span className="font-semibold text-fg">{label}</span>
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg-2 tabular-nums">{n}</span>
        </button>
        <BulkButtons
          ids={reviews.map((r) => r.id)}
          count={n}
          what={`all ${n} ${n === 1 ? "change" : "changes"} in ${label}`}
          disabled={false}
          onDecide={onDecide}
          undoes={INVENTORY_UNDO}
        />
      </div>
      {open && (
        <div className="card-grid [--card-min:260px]">
          {reviews.map((r) => (
            <InventoryCard key={r.id} review={r} onDecide={(approve) => onDecide([r.id], approve)} />
          ))}
        </div>
      )}
    </div>
  );
}

// An item's card opens the item's window (its values now, with the change) from anywhere but its buttons.
function InventoryCard({ review, onDecide }: { review: InventoryReview; onDecide: (approve: Decision) => void }) {
  const canReview = useCan("review");
  const { openItem } = useInventoryPopup();
  const open = () => review.itemId && openItem(review.itemId);
  return (
    <div
      role={review.itemId ? "button" : undefined}
      tabIndex={review.itemId ? 0 : undefined}
      onClick={(e) => isCardBodyClick(e) && open()}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
      className={`card-interactive flex flex-col gap-2 p-3 text-sm ${review.itemId ? "cursor-pointer" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate font-semibold text-fg" title={review.name}>
          {review.name}
        </div>
        {review.kind === "category" && <span className="shrink-0 rounded-full bg-gold/10 px-2 py-0.5 text-[0.625rem] font-bold tracking-wide text-gold">NEW CATEGORY</span>}
        <span className="max-w-[45%] shrink-0 truncate rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold tracking-wide text-white" title={`By ${review.aiName ?? "a member's Claude"}`}>
          {review.aiName ?? "AI"}
        </span>
        <DismissButton onClick={() => onDecide("dismiss")} />
      </div>
      <ul className="space-y-1">
        {review.changes.map((c) => (
          <li key={c.field} className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-[0.625rem] font-semibold text-subtle uppercase">{c.label}</span>
            {c.from && <span className={`${pill} border-line text-faint line-through`}>{c.from}</span>}
            {c.from && <span className="text-[0.625rem] text-faint">→</span>}
            <span className={`${pill} ${c.to ? "border-accent/60 bg-accent/5 text-accent" : "border-dashed border-line-strong text-subtle"}`}>{c.to ?? "none"}</span>
          </li>
        ))}
      </ul>
      {review.reason && (
        <p className="line-clamp-2 text-xs text-subtle" title={review.reason}>
          {review.reason}
        </p>
      )}
      <div className="text-[0.6875rem] text-subtle tabular-nums">
        {when(review.at)}
        {review.memberName ? `, ${review.memberName}` : ""}
      </div>
{canReview && (
      <div className="mt-auto flex gap-2 pt-1">
        <button type="button" onClick={() => onDecide(true)} className="btn-primary flex-1 justify-center">
          Approve
        </button>
        <button type="button" onClick={() => onDecide(false)} className="btn flex-1 justify-center">
          Reject
        </button>
      </div>
      )}
    </div>
  );
}
