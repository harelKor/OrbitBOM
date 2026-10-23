"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { deleteManualPart } from "@/app/(app)/parts-actions";
import { PartStage, type StageView } from "@/components/dashboard/PartStage";
import { DrawingPreview } from "@/components/drawing/DrawingPreview";
import { EditScope, useEditMode } from "@/components/shell/ModeContext";
import { formatPrice, useCurrency } from "@/components/cots/currency";
import { ShelfPill } from "@/components/cots/ShelfPill";
import { Icon } from "@/components/ui/Icon";
import { cotsTotal, siteOf } from "@/lib/cots";
import { useBom } from "./BomContext";
import { FilesField } from "./FilesField";
import {
  MachineField,
  MaterialField,
  NameField,
  NoteField,
  PersonField,
  PriorityField,
  QuantityField,
  StatusField,
  TextField,
  TypeField,
  machineSlotsShown,
  type SaveFn,
} from "./fields";
import { DoneCounter, DownloadMenu, MergedBadge, cadFormat } from "./PartCard";
import { InputEditor, Popover } from "./Popover";
import { ownerPartId, partTitle, type CardPart } from "./types";

// Everything about one part in a roomy window, opened by a click on a card's body. Its fields
// edit in either page mode; deleting a manual part still needs Edit mode. On document.body so a
// press inside doesn't scale the card, and clicks stop here so they don't reach the card.
export function PartDetails({ part, save, onClose }: { part: CardPart; save: SaveFn; onClose: () => void }) {
  const edit = useEditMode();
  const { robotId } = useBom();
  const [stage, setStage] = useState<StageView | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [, startTransition] = useTransition();
  const cots = part.classification === "cots";
  const format = cadFormat(part);
  const title = partTitle(part);

  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDragStart={(e) => e.stopPropagation()}>
      <Dialog open onClose={onClose} title={title} width="w-[min(60rem,calc(100vw-2rem))]">
        <EditScope>
          <div className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="space-y-3">
              <div className={`thumb-well relative flex aspect-[4/3] items-center justify-center rounded-lg border border-line ${cots ? "thumb-cots" : "thumb-made"}`}>
                {part.isManual ? (
                  <span className="text-xs text-muted">Manual part</span>
                ) : (
                  <button type="button" onClick={() => setStage("part")} className="flex h-full w-full cursor-zoom-in items-center justify-center" aria-label={`3D preview of ${title}`}>
                    {part.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                      <img src={part.thumbUrl} alt="" className="h-full w-full object-contain p-4" />
                    ) : (
                      <span className="text-xs text-muted">No thumbnail yet, click for 3D</span>
                    )}
                  </button>
                )}
                <div className="absolute top-2 left-2">
                  <MergedBadge part={part} />
                </div>
                {(format || part.files.length > 0 || part.hasDrawing) && (
                  <div className="absolute top-2 right-2">
                    <DownloadMenu part={part} format={format} />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {!part.isManual && (
                  <button type="button" className="btn" onClick={() => setStage("part")}>
                    <Icon name="cube" /> 3D preview
                  </button>
                )}
                {!part.isManual && robotId && (
                  <button type="button" className="btn" onClick={() => setStage("locate")}>
                    <Icon name="locate" /> Locate in robot
                  </button>
                )}
                {part.hasDrawing && (
                  <button type="button" className="btn" onClick={() => setDrawing(true)}>
                    <Icon name="drawing" /> Open drawing
                  </button>
                )}
                {edit && part.isManual && (
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
                )}
              </div>
            </div>

            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] content-start items-center gap-x-3 gap-y-2.5 text-sm">
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
              <Row label="Deadline">
                <ValueEditor value={part.deadline} type="date" onSave={(v) => save({ deadline: v || null })} />
              </Row>
              <Row label="Designer">
                <PersonField value={part.designerName} names={[]} onSave={(v) => save({ designerName: v })} />
              </Row>
              <Row label="Description">
                <TextField part={part} save={save} field="description" empty="Add a description" />
              </Row>
              <Row label="Notes">
                <NoteField part={part} save={save} />
              </Row>
              <Row label="Files">
                <FilesField part={part} />
              </Row>
              <Row label="Drawing link">
                <TextField part={part} save={save} field="drawingUrl" type="url" empty="Add a link" />
              </Row>
              <Row label="Est. time">
                <ValueEditor value={part.estMinutes == null ? null : String(part.estMinutes)} type="number" suffix=" min" onSave={(v) => save({ estMinutes: v ? Number(v) : null })} />
              </Row>
              <Row label="Actual time">
                <ValueEditor value={part.actualMinutes == null ? null : String(part.actualMinutes)} type="number" suffix=" min" onSave={(v) => save({ actualMinutes: v ? Number(v) : null })} />
              </Row>
              <Row label="Last edited">
                <span className="text-muted">
                  <span className="font-mono tabular-nums">{part.lastModifiedAt.toISOString().slice(0, 10)}</span>
                  {part.lastModifiedByName && ` by ${part.lastModifiedByName}`}
                </span>
              </Row>
            </dl>
          </div>
        </EditScope>
      </Dialog>
      {stage && (
        <PartStage
          partId={ownerPartId(part)}
          robotId={robotId ?? null}
          modelKey={part.modelKey}
          name={title}
          material={part.material}
          onshapeMaterial={part.geometry?.onshapeMaterial ?? null}
          view={stage}
          onView={setStage}
          onClose={() => setStage(null)}
        />
      )}
      {drawing && <DrawingPreview partId={ownerPartId(part)} title={title} onClose={() => setDrawing(false)} />}
    </div>,
    document.body,
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

// A plain value (a date or a number of minutes) that opens an input.
function ValueEditor({ value, type, suffix = "", onSave }: { value: string | null; type: "date" | "number"; suffix?: string; onSave: (v: string) => void }) {
  return (
    <Popover trigger={value ? <span className="font-mono tabular-nums">{value + suffix}</span> : <span className="text-subtle">—</span>}>
      {(close) => (
        <InputEditor
          type={type}
          value={value ?? ""}
          onCancel={close}
          onSave={(v) => {
            onSave(v.trim());
            close();
          }}
        />
      )}
    </Popover>
  );
}
