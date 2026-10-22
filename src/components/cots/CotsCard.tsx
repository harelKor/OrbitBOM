"use client";

import { useState } from "react";
import { ORDER_STATUSES, getCotsStatus } from "@/config/cots";
import { useBom } from "@/components/bom/BomContext";
import { EditMenu, NoteCloud, NotesButton } from "@/components/bom/PartCard";
import { NameField, QuantityField, StatusField, TypeBadge, TypeField, type SaveFn } from "@/components/bom/fields";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { ownerPartId, partIds, partTitle, type CardPart } from "@/components/bom/types";
import { PartStage, type StageView } from "@/components/dashboard/PartStage";
import { useEditMode } from "@/components/shell/ModeContext";
import { CheckBadge } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { cotsTotal, siteOf } from "@/lib/cots";
import type { PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { formatPrice, setCurrency, useCurrency } from "./currency";

// A COTS part's card, on every page: the name links to the product page (a dropdown when there
// are several), a small button edits the links and price, the thumbnail opens the part's place in
// the robot, − / + count how many are in stock, and the price sits at the bottom with a $ / ₪
// switch. No download, material or process: the part is bought, not made.
// On the Order List (`variant="order"`) the card is pared down to the name, the quantity, the price
// and a big status button.
export function CotsCard({
  part,
  save,
  showSystem = false,
  selected,
  onToggleSelect,
  style,
  variant = "default",
  struck = false,
  group,
}: {
  part: CardPart;
  save: SaveFn;
  showSystem?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  style?: React.CSSProperties;
  variant?: "default" | "order";
  struck?: boolean; // marked In Stock on this visit: crossed out until the page is left
  group?: { systems: number; open: boolean; onToggle: () => void }; // the same part from several systems
  fabCounter?: boolean;
  onCheck?: () => void;
}) {
  const edit = useEditMode();
  const { robotId } = useBom();
  const [stage, setStage] = useState<StageView | null>(null);
  const order = variant === "order";
  const links = part.cotsLinks ?? [];
  const title = partTitle(part);
  const stock = part.stockCount ?? 0;

  return (
    <div
      id={`part-${part.id}`}
      data-selected={!!selected}
      data-part={partIds(part)}
      style={style}
      className={`card-interactive group flex scroll-mt-20 flex-col text-sm target:border-accent target:ring-2 target:ring-accent ${
        group ? "ring-2 ring-amber-400/70 ring-offset-2 ring-offset-ink" : ""
      } ${struck ? "opacity-60" : ""}`}
    >
      {onToggleSelect && (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          aria-label={selected ? `Deselect ${title}` : `Select ${title}`}
          className="absolute inset-0 z-20 flex cursor-pointer items-start justify-end p-2"
        >
          <CheckBadge checked={!!selected} />
        </button>
      )}

      <div className="thumb-well relative flex aspect-[4/3] items-center justify-center">
        {part.isManual ? (
          <span className="text-xs text-muted">Manual part</span>
        ) : (
          <button
            type="button"
            onClick={() => setStage(robotId ? "locate" : "part")}
            className="flex h-full w-full cursor-zoom-in items-center justify-center"
            aria-label={`Locate ${title} in the robot`}
          >
            {part.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
              <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
            ) : (
              <span className="text-xs text-muted">No thumbnail yet, click for 3D</span>
            )}
          </button>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className={`rounded-full bg-[#111318]/85 font-bold text-white tabular-nums ${order ? "px-3 py-1 text-base" : "px-2 py-0.5 text-[11px]"}`}>
            {edit && !order ? <QuantityField part={part} save={save} /> : `×${part.quantity}`}
          </span>
          {!order && (edit ? <TypeField part={part} save={save} badge /> : <TypeBadge part={part} />)}
        </div>
        {group && (
          <button
            type="button"
            onClick={group.onToggle}
            className="press overlay-btn absolute top-2 right-2 w-auto gap-1 px-2 text-[11px] font-semibold"
            aria-expanded={group.open}
            title={group.open ? "Show as one card" : "Show each system's part"}
          >
            ⧉ {group.systems} systems
          </button>
        )}
        {part.note && <NoteCloud note={part.note} raised={!order} />}
        {!order && (
          <>
            <button
              type="button"
              onClick={() => save({ stockCount: Math.max(0, stock - 1) })}
              disabled={stock === 0}
              className="overlay-btn absolute bottom-2 left-2 text-lg font-bold disabled:opacity-30"
              aria-label="One less in stock"
            >
              −
            </button>
            <span
              className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#111318]/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-white tabular-nums"
              title="In stock"
            >
              {stock}/{part.quantity} in stock
            </span>
            <button
              type="button"
              onClick={() => save({ stockCount: stock + 1 })}
              className="overlay-btn absolute right-2 bottom-2 text-lg font-bold"
              aria-label="One more in stock"
            >
              +
            </button>
          </>
        )}
      </div>
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

      <div className={`flex min-w-0 flex-col p-3 ${order ? "gap-3" : "gap-2"}`}>
        <div className="flex min-w-0 items-center gap-1">
          <div className={`min-w-0 flex-1 truncate font-semibold text-fg ${order ? "text-base" : ""} ${struck ? "line-through decoration-2" : ""}`} title={title}>
            {edit && !order ? (
              <NameField part={part} save={save} bare />
            ) : links[0] ? (
              <a href={links[0].url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline" title={`Open on ${siteOf(links[0])}`}>
                {title}
              </a>
            ) : (
              title
            )}
          </div>
          {links.length > 1 && <LinksMenu links={links} />}
          {edit && !order && links[0] && (
            <a href={links[0].url} target="_blank" rel="noreferrer" className="press rounded p-0.5 text-subtle hover:text-accent" aria-label={`Open on ${siteOf(links[0])}`}>
              <Icon name="arrow" className="h-3.5 w-3.5 -rotate-45" />
            </a>
          )}
          <LinksEditor part={part} save={save} />
          {edit && !order && !group && <EditMenu part={part} />}
        </div>
        {showSystem && <div className="-mt-1.5 truncate text-xs text-subtle">{part.systemName}</div>}

        {order ? (
          <OrderStatusButton part={part} save={save} />
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <StatusField part={part} save={save} />
            </div>
            <NotesButton part={part} save={save} />
          </div>
        )}

        <Price part={part} big={order} />
      </div>
    </div>
  );
}

// The other product pages, when a part is sold on more than one site.
function LinksMenu({ links }: { links: CardPart["cotsLinks"] }) {
  return (
    <Popover align="right" hideCaret triggerClassName="rounded p-0.5 text-subtle hover:text-accent" trigger={<Icon name="chevron" className="h-3.5 w-3.5 rotate-90" />}>
      {(close) => (
        <div className="space-y-0.5 text-sm">
          <div className="px-2 pb-1 text-[11px] font-semibold text-subtle">Where to buy</div>
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={close} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-raised">
              <span className="min-w-0 truncate font-medium text-fg">{siteOf(l)}</span>
              {l.priceUsd != null && <span className="shrink-0 font-mono text-[11px] text-emerald-500 tabular-nums">${l.priceUsd.toFixed(2)}</span>}
            </a>
          ))}
        </div>
      )}
    </Popover>
  );
}

// The small pencil: edit the product links by hand, and the price of one.
function LinksEditor({ part, save }: { part: CardPart; save: SaveFn }) {
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName="rounded p-0.5 text-subtle hover:text-accent"
      trigger={
        <>
          <Icon name="pencil" className="h-3.5 w-3.5" />
          <span className="sr-only">Edit links</span>
        </>
      }
    >
      {(close) => (
        <LinksForm
          part={part}
          onCancel={close}
          onSave={(changes) => {
            save(changes);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function LinksForm({ part, onSave, onCancel }: { part: CardPart; onSave: (changes: PartChanges) => void; onCancel: () => void }) {
  const [rows, setRows] = useState(() => (part.cotsLinks?.length ? part.cotsLinks.map((l) => ({ url: l.url, site: l.site ?? "", priceUsd: l.priceUsd })) : [{ url: "", site: "", priceUsd: undefined }]));
  const [price, setPrice] = useState(part.unitPrice == null ? "" : String(part.unitPrice));
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, field: "url" | "site", v: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [field]: v } : row)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const links = rows
      .filter((r) => r.url.trim())
      .map((r) => ({ url: r.url.trim(), ...(r.site.trim() ? { site: r.site.trim() } : {}), ...(r.priceUsd != null ? { priceUsd: r.priceUsd } : {}) }));
    if (links.some((l) => !/^https?:\/\/\S+$/.test(l.url))) return setError("Links start with https://");
    const unit = price.trim() === "" ? null : Number(price);
    if (unit !== null && (!Number.isFinite(unit) || unit < 0)) return setError("The price is a number of dollars.");
    onSave({ cotsLinks: links, unitPrice: unit });
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-sm">
      <div className="text-[11px] font-semibold text-subtle">Product links (the first is the name&apos;s link)</div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1">
          <input value={r.url} onChange={(e) => set(i, "url", e.target.value)} placeholder="https://…" className="input min-w-0 flex-1 py-1.5" autoFocus={i === 0} aria-label="Link" />
          <input value={r.site} onChange={(e) => set(i, "site", e.target.value)} placeholder="Site" className="input w-20 py-1.5" aria-label="Site name" />
          <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="press rounded px-1 text-subtle hover:text-rose-500" aria-label="Remove link">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((r) => [...r, { url: "", site: "", priceUsd: undefined }])} className="press text-xs font-medium text-accent">
        + Add link
      </button>
      <label className="flex items-center gap-2 pt-1">
        <span className="text-[11px] font-semibold text-subtle">Price of one ($)</span>
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="input w-24 py-1.5 font-mono tabular-nums" />
      </label>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary">Save</button>
      </div>
    </form>
  );
}

// The part's price for the quantity needed, in green, with the $ / ₪ switch.
function Price({ part, big }: { part: CardPart; big: boolean }) {
  const currency = useCurrency();
  const total = cotsTotal(part);
  return (
    <div className="flex items-center gap-2">
      {total == null ? (
        <span className="text-xs text-faint">No price yet</span>
      ) : (
        <span
          className={`font-mono font-bold text-emerald-500 tabular-nums ${big ? "text-xl" : "text-base"}`}
          title={part.quantity > 1 ? `${formatPrice(part.unitPrice!, currency)} each` : undefined}
        >
          {formatPrice(total, currency)}
        </span>
      )}
      {total != null && (
        <button
          type="button"
          onClick={() => setCurrency(currency === "usd" ? "ils" : "usd")}
          className="press rounded-full border border-line-strong px-1.5 text-[11px] font-semibold text-muted hover:border-emerald-500/60 hover:text-emerald-500"
          aria-label={currency === "usd" ? "Show in shekels" : "Show in dollars"}
          title={currency === "usd" ? "Show in shekels" : "Show in dollars"}
        >
          {currency === "usd" ? "₪" : "$"}
        </button>
      )}
    </div>
  );
}

// The Order List's big status button: In Order List, Seen, In Route, In Stock.
function OrderStatusButton({ part, save }: { part: CardPart; save: SaveFn }) {
  const status = computeStatus(part);
  const color = getCotsStatus(status)?.color ?? "#cbd5e1";
  return (
    <Popover
      hideCaret
      triggerClassName="w-full"
      trigger={
        <span className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-bold shadow-sm" style={{ background: color, color: textOn(color) }}>
          {status}
          <span className="text-xs opacity-70">▾</span>
        </span>
      }
    >
      {(close) => (
        <div className="space-y-1.5 p-1">
          {ORDER_STATUSES.map((s) => {
            const c = getCotsStatus(s)!.color;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (s !== status) save({ status: s });
                  close();
                }}
                className={`press flex w-full items-center justify-center rounded-xl py-3 text-base font-bold ${s === status ? "ring-2 ring-fg/40" : ""}`}
                style={{ background: c, color: textOn(c) }}
              >
                {s}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
