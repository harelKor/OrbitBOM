"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { deleteManualPart } from "@/app/(app)/parts-actions";
import { inventoryPicker } from "@/app/(app)/inventory/actions";
import { PartModel, type StageView } from "@/components/dashboard/PartStage";
import { DrawingEditor } from "@/components/drawing/DrawingEditor";
import { AddBox } from "@/components/inventory/AddBox";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useCan, useManage } from "@/components/shell/ModeContext";
import { formatPrice, useCurrency } from "@/components/cots/currency";
import { ShelfPill } from "@/components/cots/ShelfPill";
import { Icon } from "@/components/ui/Icon";
import { FabVersionBadge, PartVersionsButton } from "@/components/versions/PartVersionsWindow";
import { cotsTotal, siteOf } from "@/lib/cots";
import { fabStage } from "@/lib/fab";
import { useBom } from "./BomContext";
import { upload } from "./FilesField";
import { MachineField, MaterialField, NameField, PersonField, PriorityField, QuantityField, StatusField, TypeField, machineSlotsShown, type SaveFn } from "./fields";
import { DoneCounter, DownloadMenu, MergedBadge, cadFormat } from "./PartCard";
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

          <div className="min-w-0 space-y-5">
            {!part.isManual && !cots && <PartVersionsButton partId={part.id} lock={part.fabLock} released={fabStage(part) !== null} />}
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] content-start items-center gap-x-3 gap-y-2 text-sm">
              <Row label="Name">
                <NameField part={part} save={save} />
              </Row>
              <Row label="System">{part.systemName}</Row>
              <Row label="Type">
                <TypeField part={part} save={save} />
              </Row>
              <Row label="Quantity">
                <span className="font-mono tabular-nums">
                  <QuantityField part={part} save={save} />
                </span>
              </Row>
              <Row label="Status">
                <StatusField part={part} save={save} />
              </Row>
              {cots ? <CotsRows part={part} save={save} /> : <MadeRows part={part} save={save} />}
              <Row label="Priority">
                <PriorityField part={part} save={save} />
              </Row>
              <Row label="Designer">
                <PersonField value={part.designerName} names={[]} onSave={(v) => save({ designerName: v })} />
              </Row>
              <Row label="Last edited">
                <span className="text-muted">
                  <span className="font-mono tabular-nums">{part.lastModifiedAt.toISOString().slice(0, 10)}</span>
                  {part.lastModifiedByName && ` by ${part.lastModifiedByName}`}
                </span>
              </Row>
            </dl>
            <InventoryLink part={part} save={save} />
            {!cots && canDraw && (
              <div className="flex flex-wrap items-center gap-2">
                {!part.isManual && <DrawingAction partId={ownerPartId(part)} hasDrawing={!!part.hasDrawing} />}
                <DrawingFileButton part={part} />
              </div>
            )}
          </div>
        </div>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs font-medium text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </>
  );
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
function InventoryLink({ part, save }: { part: CardPart; save: SaveFn }) {
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
      {itemId && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
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
      {work && <AddBox
        q={q}
        setQ={setQ}
        items={data?.items ?? []}
        categories={data?.categories ?? []}
        locations={data?.locations ?? []}
        conditions={data?.conditions ?? []}
        defaultCategory={null}
        placeholder={itemId ? "Link another item: search, paste a link or add one" : "Link an inventory item: search, paste a link or add one"}
        onPick={(id) => save({ inventoryItemId: id })}
        floating
      />}
    </section>
  );
}

// Material and each machine with how many are done there.
function MadeRows({ part, save }: { part: CardPart; save: SaveFn }) {
  return (
    <>
      <Row label="Material">
        <MaterialField part={part} save={save} />
      </Row>
      {machineSlotsShown(part).map((slot) => (
        <Row key={slot.key} label={slot.label}>
          <span className="flex min-w-0 items-center gap-2">
            <MachineField part={part} save={save} slot={slot} placeholder="None" />
            {part[slot.key] && <DoneCounter part={part} save={save} slot={slot} />}
          </span>
        </Row>
      ))}
    </>
  );
}

// Where to buy it, the price and the shelf.
function CotsRows({ part, save }: { part: CardPart; save: SaveFn }) {
  const currency = useCurrency();
  const total = cotsTotal(part);
  const links = part.cotsLinks ?? [];
  return (
    <>
      <Row label="Where to buy">
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
      <Row label="Price">
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
