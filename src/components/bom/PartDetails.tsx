"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { deleteManualPart } from "@/app/(app)/parts-actions";
import { inventoryPicker } from "@/app/(app)/inventory/actions";
import { approveParts, partReviewState, rejectParts, suggestPart, type PartReviewState } from "@/app/(app)/robots/[robotId]/review/actions";
import { PartModel, type StageView } from "@/components/dashboard/PartStage";
import { DrawingEditor } from "@/components/drawing/DrawingEditor";
import { AddBox } from "@/components/inventory/AddBox";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useCan, useManage } from "@/components/shell/ModeContext";
import { formatPrice, useCurrency } from "@/components/cots/currency";
import { ShelfPill } from "@/components/cots/ShelfPill";
import { Icon } from "@/components/ui/Icon";
import { getMachine } from "@/config/machines";
import { FabVersionBadge, PartVersionsButton } from "@/components/versions/PartVersionsWindow";
import { cotsTotal, siteOf } from "@/lib/cots";
import { fabStage } from "@/lib/fab";
import { useBom } from "./BomContext";
import { upload } from "./FilesField";
import { MachineField, MaterialField, NameField, QuantityField, StatusField, TypeField, machineSlotsShown, type SaveFn } from "./fields";
import { DownloadMenu, MergedBadge, cadFormat } from "./PartCard";
import { ownerPartId, partTitle, type CardPart } from "./types";

type Stage = StageView | "thumb";

// Everything about one part in a roomy window, opened by a click anywhere on its card. On the
// left the live 3D part (Locate in robot and the 2D thumbnail on it) and the notes right under it;
// on the right its properties, its inventory link and, under the inventory search, the drawing. Its
// fields edit by the member's mode (fields.tsx): any team sets status, material and machines, the
// CAD Team makes drawings, and Edit mode does the rest (name, type, deleting a manual part).
export function PartDetails({ part, save, onClose }: { part: CardPart; save: SaveFn; onClose: () => void }) {
  const edit = useManage();
  const canDraw = useCan("draw");
  const { robotId } = useBom();
  const [stage, setStage] = useState<Stage>(part.isManual ? "thumb" : "part");
  const [, startTransition] = useTransition();
  const cots = part.classification === "cots";
  const format = cadFormat(part);
  const title = partTitle(part);
  const canLocate = !part.isManual && !!robotId && !!part.modelKey;
  const overlay = "btn h-8 gap-1.5 bg-surface/95 text-xs shadow-sm";
  const suggest = useSuggest(part, !part.memberIds);
  const was = (field: string) => suggest.was[field];

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          {title}
          {part.fabLock && !cots && <FabVersionBadge lock={part.fabLock} />}
        </>
      }
      actions={
        <>
          {!part.isManual && !cots && <PartVersionsButton partId={part.id} lock={part.fabLock} released={fabStage(part) !== null} />}
          {suggest.suggestButton}
          {!cots && canDraw && !part.isManual && <DrawingAction partId={ownerPartId(part)} hasDrawing={!!part.hasDrawing} />}
          {!cots && canDraw && <DrawingFileButton part={part} />}
        </>
      }
      width="w-[min(74rem,calc(100vw-2rem))]">
        <div className="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line">
              {stage === "thumb" ? (
                <div className={`thumb-well flex h-full w-full items-center justify-center ${cots ? "thumb-cots" : "thumb-made"}`}>
                  {part.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                    <img src={part.thumbUrl} alt="" className="h-full w-full object-contain p-4" />
                  ) : (
                    <span className="text-xs text-muted">{part.isManual ? "Manual part" : "No thumbnail yet"}</span>
                  )}
                </div>
              ) : (
                <PartModel
                  partId={ownerPartId(part)}
                  robotId={robotId ?? null}
                  modelKey={part.modelKey}
                  view={stage}
                  onView={setStage}
                  locateButton={false}
                  className="h-full w-full"
                />
              )}
              {!part.isManual && (
                <div className="absolute top-3 right-3 flex gap-1.5">
                  <button type="button" className={overlay} aria-pressed={stage === "thumb"} onClick={() => setStage(stage === "thumb" ? "part" : "thumb")}>
                    <Icon name={stage === "thumb" ? "cube" : "image"} className="h-3.5 w-3.5" />
                    {stage === "thumb" ? "3D" : "Thumbnail"}
                  </button>
                  {canLocate && (
                    <button type="button" className={overlay} aria-pressed={stage === "locate"} onClick={() => setStage(stage === "locate" ? "part" : "locate")}>
                      <Icon name={stage === "locate" ? "cube" : "locate"} className="h-3.5 w-3.5" />
                      {stage === "locate" ? "Part only" : "Locate in robot"}
                    </button>
                  )}
                </div>
              )}
              <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
                <MergedBadge part={part} />
              </div>
              {(format || part.files.length > 0 || part.hasDrawing) && (
                <div className="absolute right-3 bottom-3">
                  <DownloadMenu part={part} format={format} />
                </div>
              )}
            </div>

            <NotesBox part={part} save={save} />

            {edit && part.isManual && (
              <div className="flex">
                <button
                  type="button"
                  className="btn-danger ml-auto"
                  onClick={() => {
                    if (!confirm(`Delete "${title}"?`)) return;
                    onClose();
                    startTransition(() => void deleteManualPart(part.id));
                  }}
                >
                  Delete part
                </button>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            {suggest.message}
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] content-start items-center gap-x-3 gap-y-3">
              <Row label="Name" was={was("displayName")}>
                <NameField part={part} save={save} />
              </Row>
              <Row label="System">{part.systemName}</Row>
              <Row label="Type" was={was("classification")}>
                <TypeField part={part} save={save} />
              </Row>
              <Row label="Quantity" was={was("quantity")}>
                <span className="font-mono tabular-nums">
                  <QuantityField part={part} save={save} />
                </span>
              </Row>
              <Row label="Status" was={was("status")}>
                <StatusField part={part} save={save} />
              </Row>
              {cots ? <CotsRows part={part} save={save} was={was} /> : <MadeRows part={part} save={save} was={was} />}
              <Row label="Last edited">
                <span className="text-muted">
                  <span className="font-mono tabular-nums">{part.lastModifiedAt.toISOString().slice(0, 10)}</span>
                  {part.lastModifiedByName && ` by ${part.lastModifiedByName}`}
                </span>
              </Row>
            </dl>
            <InventoryLink part={part} save={save} diff={suggest.inventory} />
            {suggest.actions}
          </div>
        </div>
    </Dialog>
  );
}

// One property. `was` is its value before a suggestion waiting in To Review changed it: the row
// then shows the old value struck through, an arrow, and the new value glowing.
function Row({ label, was, children }: { label: string; was?: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="w-28 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 py-0.5 text-base font-medium break-words text-fg">
        {was === undefined ? (
          children
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-y-1">
            <span className="text-xs text-muted line-through decoration-rose-400/80 sm:text-sm">{was}</span>
            <span className="mx-1.5 text-muted">→</span>
            <Glow>{children}</Glow>
          </span>
        )}
      </dd>
    </>
  );
}

function Glow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex min-w-0 items-center rounded-lg bg-sky-500/10 px-2 py-0.5 shadow-[0_0_14px_rgba(56,189,248,0.35)] ring-2 ring-sky-400/70 ${className}`}>{children}</span>;
}

// The part's note, always open to type in: it saves when the box loses focus. The card shows it
// as the yellow cloud on its thumbnail.
function NotesBox({ part, save }: { part: CardPart; save: SaveFn }) {
  const work = useCan("work");
  const [text, setText] = useState(part.note ?? "");
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(part.note);
  // A note changed elsewhere (another member, Undo) shows here unless it's being typed in.
  if (seen !== part.note && !focused) {
    setSeen(part.note);
    setText(part.note ?? "");
  }
  return (
    <label className="block rounded-xl border-2 border-amber-400/70 bg-amber-50 px-3 py-2 shadow-[3px_4px_0_0_rgba(245,158,11,0.25)] focus-within:border-amber-500 dark:bg-amber-400/10">
      <span className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-amber-700 uppercase dark:text-amber-300">
        <Icon name="note" className="h-3.5 w-3.5" />
        Notes
      </span>
      <textarea
        value={text}
        rows={2}
        readOnly={!work}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (text.trim() !== (part.note ?? "").trim()) save({ note: text.trim() });
        }}
        placeholder={work ? "Add a note for whoever makes or orders this part…" : "No note"}
        className="mt-0.5 block w-full resize-y bg-transparent text-sm leading-snug font-semibold text-fg outline-none placeholder:font-normal placeholder:text-amber-700/50 dark:placeholder:text-amber-300/40"
      />
    </label>
  );
}

// Make the part's drawing from Onshape, or open the one it has in the drawing editor. `compact` is
// the part card's icon button. The editor goes on document.body, its clicks stopped there, so a
// press inside doesn't reach the card it was opened from.
export function DrawingAction({ partId, hasDrawing, compact = false }: { partId: string; hasDrawing: boolean; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  async function onClick() {
    if (hasDrawing) return setOpen(true);
    setMaking(true);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    setMaking(false);
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? "Couldn't make the drawing.");
    router.refresh();
    setOpen(true);
  }
  const label = making ? "Making the drawing…" : hasDrawing ? "Open drawing" : "Make drawing";
  return (
    <>
      {compact ? (
        <button type="button" onClick={onClick} disabled={making} className={`overlay-btn ${making ? "animate-pulse" : ""}`} aria-label={label} title={label}>
          <Icon name="spark" />
        </button>
      ) : (
        <button type="button" onClick={onClick} disabled={making} className={`btn h-8 gap-1.5 text-xs ${making ? "animate-pulse" : ""}`}>
          <Icon name="drawing" className="h-3.5 w-3.5" />
          {label}
        </button>
      )}
      {open &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <DrawingEditor partId={partId} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}

// Upload a drawing file (a PDF or picture made outside the app); the card's View drawing opens it.
// `compact` is the part card's icon button.
export function DrawingFileButton({ part, compact = false }: { part: CardPart; compact?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const file = part.files.find((f) => f.type === "drawing");
  const label = busy ? "Uploading…" : file ? "Replace drawing file" : "Add drawing file";
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`${compact ? "overlay-btn" : "btn h-8 gap-1.5 text-xs"} ${busy ? "animate-pulse" : ""}`}
        aria-label={compact ? label : undefined}
        title={file ? `Replace ${file.filename}` : "Upload a drawing file"}
      >
        <Icon name="download" className={compact ? "rotate-180" : "h-3.5 w-3.5 rotate-180"} />
        {!compact && label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".pdf,.png,.jpg,.jpeg,.svg,.dxf,.dwg,image/*,application/pdf"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          const error = await upload({ kind: "part", id: ownerPartId(part) }, "drawing", f);
          setBusy(false);
          if (error) alert(error);
          else router.refresh();
        }}
      />
    </>
  );
}

// The inventory item the part is linked to, and the Inventory page's search box to link it: an
// item on the shelf, a store product or a custom item, added and linked in one go.
function InventoryLink({ part, save, diff }: { part: CardPart; save: SaveFn; diff: InventoryDiff }) {
  const work = useCan("work");
  const { inventory } = useBom();
  const { openItem } = useInventoryPopup();
  const [q, setQ] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof inventoryPicker>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    inventoryPicker().then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, []);
  const itemId = part.inventoryItemId;
  const name = itemId ? (data?.items.find((i) => i.id === itemId)?.name ?? inventory.find((i) => i.id === itemId)?.name ?? part.shelf?.itemName ?? "Inventory item") : null;

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-subtle uppercase">
        <Icon name="box" className="h-3.5 w-3.5" />
        Inventory
      </h3>
      {diff?.pending && (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 text-muted line-through decoration-rose-400/80">{name ?? "Unlinked"}</span>
          <span className="shrink-0 text-muted">→</span>
          <Glow className="min-w-0 flex-1 py-2">
            <span className="min-w-0 flex-1 truncate font-semibold text-fg" title={diff.pending}>
              {diff.pending}
            </span>
            <span className="ml-2 shrink-0 text-xs text-muted">links on Approve</span>
          </Glow>
        </div>
      )}
      {itemId && diff && !diff.pending && (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 text-muted line-through decoration-rose-400/80">{diff.was}</span>
          <span className="shrink-0 text-muted">→</span>
        </div>
      )}
      {itemId && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            diff && !diff.pending ? "border-transparent bg-sky-500/10 shadow-[0_0_14px_rgba(56,189,248,0.35)] ring-2 ring-sky-400/70" : "border-emerald-500/40 bg-emerald-500/5"
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-semibold text-fg" title={name ?? undefined}>
            {name}
          </span>
          <button type="button" className="btn h-8 text-xs" onClick={() => openItem(itemId)}>
            Open
          </button>
          {work && (
            <button type="button" className="btn h-8 text-xs" onClick={() => save({ inventoryItemId: null })}>
              Unlink
            </button>
          )}
        </div>
      )}
      {!itemId && !work && <p className="text-sm text-subtle">Not linked to an inventory item.</p>}
      {work && !itemId && <AddBox
        q={q}
        setQ={setQ}
        items={data?.items ?? []}
        categories={data?.categories ?? []}
        locations={data?.locations ?? []}
        conditions={data?.conditions ?? []}
        defaultCategory={null}
        placeholder="Link an inventory item: search, paste a link or add one"
        onPick={(id) => save({ inventoryItemId: id })}
        searchFor={partTitle(part)}
        floating
      />}
    </section>
  );
}

const FIELD_NAMES: Record<string, string> = {
  classification: "type",
  material: "material",
  inventoryItemId: "inventory link",
  preProcess: "pre-process",
  process1: "machine 1",
  process2: "machine 2",
  displayName: "name",
  cotsLinks: "product links",
  unitPrice: "price",
  cotsCategory: "COTS category",
};

type InventoryDiff = { was: string; pending: string | null } | null;

// A field's value as the "before" of a suggestion: machine names, COTS / In-House, item names.
function formatOld(field: string, value: unknown, itemNames: Record<string, string>): string {
  if (value === null || value === undefined || value === "") return field === "inventoryItemId" ? "Unlinked" : "None";
  if (field === "classification") return value === "cots" ? "COTS" : "In-House";
  if (field === "preProcess" || field === "process1" || field === "process2") return getMachine(String(value))?.name ?? String(value);
  if (field === "inventoryItemId") return itemNames[String(value)] ?? "Inventory item";
  if (Array.isArray(value)) return value.length ? `${value.length} ${value.length === 1 ? "link" : "links"}` : "None";
  if (typeof value === "object") return "—";
  return String(value);
}

// Suggest runs the site's setup rules and auto-link on this one part. Whatever waits in To Review
// for it (from Suggest, Suggest setup, auto-link or a member's Claude) shows on the rows it changed
// as "old → new", with big Approve (keep it) and Reject (put the old values back) at the bottom
// right of the window. Suggest sits in the title bar; who suggested it shows over the properties.
function useSuggest(part: CardPart, enabled: boolean): {
  suggestButton: React.ReactNode;
  message: React.ReactNode;
  actions: React.ReactNode;
  was: Record<string, string>;
  inventory: InventoryDiff;
} {
  const review = useCan("review") && enabled;
  const [state, setState] = useState<PartReviewState | undefined>(undefined);
  const [busy, setBusy] = useState<"suggest" | "approve" | "reject" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Read again whenever the part changes (a save, an Approve elsewhere, a refresh).
  const version = part.lastModifiedAt.getTime();
  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    partReviewState(part.id).then((s) => !cancelled && setState(s));
    return () => {
      cancelled = true;
    };
  }, [review, part.id, version, tick]);
  if (!review) return { suggestButton: null, message: null, actions: null, was: {}, inventory: null };

  const run = async (kind: "suggest" | "approve" | "reject") => {
    setBusy(kind);
    setNote(null);
    const r = kind === "suggest" ? await suggestPart(part.id) : kind === "approve" ? await approveParts([part.id]) : await rejectParts([part.id]);
    setBusy(null);
    if (r.error) return alert(r.error);
    setNote(r.message ?? null);
    setTick((t) => t + 1);
  };
  const waiting = !!state && (state.fields.length > 0 || !!state.pendingItem);
  const what = state ? [...state.fields.map((f) => FIELD_NAMES[f] ?? f), ...(state.pendingItem ? [`link to "${state.pendingItem}"`] : [])] : [];
  const by = state?.source === "ai" ? (state.aiName ?? "Claude") : "Suggest";

  const was: Record<string, string> = {};
  let inventory: InventoryDiff = null;
  if (waiting && state) {
    for (const [field, c] of Object.entries(state.changes)) {
      if (field !== "inventoryItemId") was[field] = formatOld(field, c.from, state.itemNames);
    }
    const linked = state.changes.inventoryItemId;
    if (state.pendingItem) inventory = { was: "Unlinked", pending: state.pendingItem };
    else if (linked) inventory = { was: formatOld("inventoryItemId", linked.from, state.itemNames), pending: null };
  }

  const suggestButton = (
    <button type="button" className={`btn h-8 gap-1.5 text-xs active:scale-[0.98] ${busy === "suggest" ? "animate-pulse" : ""}`} disabled={!!busy} onClick={() => run("suggest")} title="Guess material, machines and the inventory item for this part">
      <Icon name="spark" className="h-3.5 w-3.5 text-amber-500" />
      {busy === "suggest" ? "Suggesting…" : "Suggest"}
    </button>
  );
  const actions = waiting ? (
    <div className="mt-auto flex items-center justify-end gap-3 pt-4">
      <button
        type="button"
        className={`rounded-xl border border-rose-500/50 bg-rose-500/15 px-5 py-2.5 text-sm font-semibold text-rose-700 transition-colors duration-150 hover:bg-rose-500/25 active:scale-[0.98] disabled:opacity-60 dark:text-rose-200 ${busy === "reject" ? "animate-pulse" : ""}`}
        disabled={!!busy}
        onClick={() => run("reject")}
        title="Put the old values back"
      >
        {busy === "reject" ? "Rejecting…" : "Reject"}
      </button>
      <button
        type="button"
        className={`rounded-xl border border-emerald-500/60 bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-700 shadow-[0_0_16px_rgba(16,185,129,0.25)] transition-colors duration-150 hover:bg-emerald-500/30 active:scale-[0.98] disabled:opacity-60 dark:text-emerald-200 ${busy === "approve" ? "animate-pulse" : ""}`}
        disabled={!!busy}
        onClick={() => run("approve")}
        title="Keep the suggested values"
      >
        {busy === "approve" ? "Approving…" : "Approve"}
      </button>
    </div>
  ) : null;
  const message = waiting ? (
    <p className="border-l-2 border-sky-400/60 pl-2.5 text-sm leading-snug text-muted">
      <span className="font-semibold text-fg">{by}</span> suggested {what.join(", ")}
      {state?.reason && <span className="block text-subtle">{state.reason}</span>}
    </p>
  ) : note ? (
    <p className="text-sm text-muted">{note}</p>
  ) : null;
  return { suggestButton, message, actions, was, inventory };
}

// Material and each machine with how many are done there.
type Was = (field: string) => string | undefined;

function MadeRows({ part, save, was }: { part: CardPart; save: SaveFn; was: Was }) {
  return (
    <>
      <Row label="Material" was={was("material")}>
        <MaterialField part={part} save={save} />
      </Row>
      {machineSlotsShown(part).map((slot) => (
        <Row key={slot.key} label={slot.label} was={was(slot.key)}>
          <span className="flex min-w-0 items-center gap-2">
            <MachineField part={part} save={save} slot={slot} placeholder="None" />
          </span>
        </Row>
      ))}
    </>
  );
}

// Where to buy it, the price and the shelf.
function CotsRows({ part, save, was }: { part: CardPart; save: SaveFn; was: Was }) {
  const currency = useCurrency();
  const total = cotsTotal(part);
  const links = part.cotsLinks ?? [];
  return (
    <>
      <Row label="Where to buy" was={was("cotsLinks")}>
        {links.length ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400">
                {siteOf(l)}
              </a>
            ))}
          </span>
        ) : (
          <span className="text-subtle">No links yet</span>
        )}
      </Row>
      <Row label="Price" was={was("unitPrice")}>
        {part.unitPrice == null || total == null ? (
          <span className="text-subtle">—</span>
        ) : (
          <span className="font-mono tabular-nums">
            {formatPrice(part.unitPrice, currency)} each · {formatPrice(total, currency)}
          </span>
        )}
      </Row>
      <Row label="Stock">
        {part.shelf ? <ShelfPill part={part} shelf={part.shelf} save={save} /> : <span className="font-mono tabular-nums">{part.stockCount}/{part.quantity} in stock</span>}
      </Row>
    </>
  );
}
