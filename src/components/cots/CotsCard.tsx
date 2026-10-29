"use client";

import { useOptimistic, useState, useTransition } from "react";
import { COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, ORDER_STATUSES, getCotsStatus } from "@/config/cots";
import { Dialog } from "@/components/Dialog";
import { statusTint } from "@/components/ui/statusTint";
import { useBom } from "@/components/bom/BomContext";
import { EditMenu, MergedBadge, NoteCloud, isCardBodyClick } from "@/components/bom/PartCard";
import { usePartDetails } from "@/components/bom/PartDetailsHost";
import { QuantityField, StatusField, TypeBadge, TypeField, type SaveFn } from "@/components/bom/fields";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { partIds, partTitle, type CardPart } from "@/components/bom/types";
import { VersionTag } from "@/components/versions/VersionTag";
import { useCan, useManage } from "@/components/shell/ModeContext";
import { CheckBadge } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { cotsTotal, siteOf } from "@/lib/cots";
import { formatStock } from "@/lib/inventory/stock";
import type { PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { stepShelfStock } from "@/app/(app)/inventory/actions";
import { LinkTag, ShelfCoversPrompt, ShelfPill } from "./ShelfPill";
import { formatPrice, setCurrency, useCurrency } from "./currency";

// A COTS part's card, on every page, washed in its status colour: the light-blue name links to the
// product page (a dropdown when there are several), a small pencil edits the name, links and
// price, the thumbnail (light green: bought) opens the part's place in the robot, red − / green +
// count how many are in stock (reaching the quantity sets In Stock), and the price sits right of
// the status with a $ / ₪ switch. No download, material or process: the part is bought, not made.
// On the Order List (`variant="order"`) the card is pared down to the name, the quantity, the price
// and a big status button. A part the Order List sent back carries a red tag with the reason.
// On Released (`origin`) the thumbnail says where the part came from (General: sent from the
// inventory or added for no robot; Robot: a robot's BOM) and the count is the whole shelf against
// the item's whole need ("7 / 20 on shelf"). A part with no picture of its own shows its item's.
export function CotsCard({
  part,
  save,
  showSystem = false,
  highlightSystem = false,
  selected,
  onToggleSelect,
  style,
  variant = "default",
  struck = false,
  group,
  shelfOnThumb = false,
  origin,
}: {
  part: CardPart;
  save: SaveFn;
  showSystem?: boolean;
  highlightSystem?: boolean; // one system's part inside an opened group: its system stands out
  selected?: boolean;
  onToggleSelect?: () => void;
  style?: React.CSSProperties;
  variant?: "default" | "order";
  struck?: boolean; // marked In Stock on this visit: crossed out until the page is left
  group?: { systems: number; onOpen: () => void }; // the same part from several systems: a click opens it
  fabCounter?: boolean;
  onCheck?: () => void;
  // On the COTS page the inventory tag sits on the thumbnail, so every card is the same height.
  shelfOnThumb?: boolean;
  origin?: "General" | "Robot";
}) {
  const edit = useManage();
  const work = useCan("work");
  const { versions } = useBom();
  const showDetails = usePartDetails(part, save);
  const order = variant === "order";
  const links = part.cotsLinks ?? [];
  const title = partTitle(part);
  const status = computeStatus(part);
  const sentBack = status === COTS_RELEASED && part.cotsSentBack;
  // A part linked to an inventory item counts on the item's shelf: − / + move the item's stock
  // and the count shows how much of the part the shelf covers. Otherwise the part keeps its own.
  const [shelf, stepShelf] = useOptimistic(part.shelf ?? null, (s, d: number) =>
    s && { ...s, inStock: Math.max(0, s.inStock + d), covered: Math.min(part.quantity, Math.max(0, s.covered + d)) },
  );
  const [, startShelf] = useTransition();
  const onShelf = !!shelf && !shelf.sheet;
  // A suggested item shows as the Link tag on the thumbnail (the pill only for those who can't link).
  const hasShelfTag = !!shelf || (!work && !!part.shelfSuggestion);
  const stock = onShelf ? shelf.covered : (part.stockCount ?? 0);
  const addStock = (d: number) => {
    if (onShelf) {
      startShelf(async () => {
        stepShelf(d);
        await stepShelfStock(part.memberIds ?? [part.id], d);
      });
      return;
    }
    const next = Math.max(0, stock + d);
    // Enough on the shelf: the part is in stock.
    save(next >= Math.max(part.quantity, 1) && status !== COTS_IN_STOCK ? { stockCount: next, status: COTS_IN_STOCK } : { stockCount: next });
  };
  // A click anywhere but the card's own controls (and their popovers) opens it: a grouped card
  // shows each system's part, any other card the part's details window.
  const onCardClick = (e: React.MouseEvent) => {
    if (onToggleSelect || !isCardBodyClick(e)) return;
    if (group) group.onOpen();
    else showDetails();
  };
  const picture = (!part.isManual && part.thumbUrl) || shelf?.thumbUrl || null;
  const thumb = picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
    <img src={picture} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
  ) : (
    <span className="text-xs text-muted">{part.isManual ? "Manual part" : "No thumbnail yet"}</span>
  );
  // Released: the whole shelf against the item's whole need.
  const wholeShelf = !!origin && onShelf;

  return (
    <div
      id={`part-${part.id}`}
      data-selected={!!selected}
      data-part={partIds(part)}
      style={style ?? statusTint(status)}
      onClick={onCardClick}
      className={`card-interactive group flex scroll-mt-20 cursor-pointer flex-col text-sm target:border-accent target:ring-2 target:ring-accent ${
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

      <div className="thumb-well thumb-cots relative flex aspect-[4/3] items-center justify-center">
        <div className="flex h-full w-full items-center justify-center">{thumb}</div>
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className={`rounded-full bg-[#111318]/85 font-bold text-white tabular-nums ${order ? "px-3 py-1 text-base" : "px-2 py-0.5 text-[11px]"}`}>
            {work && !order ? <QuantityField part={part} save={save} /> : `×${part.quantity}`}
          </span>
          {!order && (edit ? <TypeField part={part} save={save} badge /> : <TypeBadge part={part} />)}
          {!group && <MergedBadge part={part} />}
        </div>
        <div className="absolute top-2 right-2 flex max-w-[55%] flex-col items-end gap-1">
          {origin && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold shadow-sm ${origin === "General" ? "bg-[#0D111A]/85 text-amber-300" : "bg-sky-500 text-white"}`}
              title={origin === "General" ? "Sent from the inventory, or added for no robot" : "From a robot's BOM"}
            >
              {origin}
            </span>
          )}
          {group && (
            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950 shadow-sm" title="Click to see each system's part">
              ⧉ {group.systems} systems
            </span>
          )}
          {!order && <LinkTag part={part} save={save} />}
          {sentBack && (
            <span className="max-w-full truncate rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-md" title={`Sent back: ${part.cotsSentBack}`}>
              ↩ {part.cotsSentBack}
            </span>
          )}
        </div>
        {part.note && <NoteCloud note={part.note} raised={!order} />}
        {shelfOnThumb && hasShelfTag && !(wholeShelf && shelf) && (
          <div className={`absolute flex max-w-[90%] rounded-full bg-surface/90 shadow-sm backdrop-blur-md ${order ? "bottom-2 left-2" : "bottom-12 left-1/2 -translate-x-1/2"}`}>
            <ShelfPill part={part} shelf={shelf} save={save} />
          </div>
        )}
        {versions && (
          <div className={`absolute ${order ? "right-2 bottom-2" : "bottom-9 left-1/2 -translate-x-1/2"}`}>
            <VersionTag partId={part.id} tags={versions} manual={part.isManual} />
          </div>
        )}
        {!order && (
          <>
            {work && <button
              type="button"
              onClick={() => addStock(-1)}
              disabled={onShelf ? shelf.inStock === 0 : stock === 0}
              className="press absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-md bg-rose-500 text-lg font-bold text-white shadow-sm hover:bg-rose-400 disabled:opacity-30"
              aria-label="One less in stock"
            >
              −
            </button>}
            <span
              className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#111318]/80 px-2 py-0.5 font-mono text-[11px] font-semibold whitespace-nowrap text-white tabular-nums"
              title={onShelf ? (wholeShelf ? `${shelf.itemName} on the shelf / everything needed` : `Covered by ${shelf.itemName} on the shelf`) : "In stock"}
            >
              {wholeShelf
                ? `${formatStock(shelf.inStock)} / ${formatStock(shelf.total || part.quantity)} on shelf`
                : `${stock}/${part.quantity} ${onShelf ? "on shelf" : "in stock"}`}
            </span>
            {work && <button
              type="button"
              onClick={() => addStock(1)}
              className="press absolute right-2 bottom-2 flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500 text-lg font-bold text-white shadow-sm hover:bg-emerald-400"
              aria-label="One more in stock"
            >
              +
            </button>}
          </>
        )}
      </div>

      <div className={`flex min-w-0 flex-col ${order ? "gap-3 p-3" : "gap-1.5 px-2.5 py-2"}`}>
        <div className="flex min-w-0 items-center gap-1">
          <div className={`min-w-0 flex-1 truncate font-semibold ${order ? "text-base" : ""} ${struck ? "line-through decoration-2" : ""}`} title={title}>
            {links[0] ? (
              <a
                href={links[0].url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-500 underline-offset-2 hover:underline dark:text-sky-400"
                title={`Open on ${siteOf(links[0])}`}
              >
                {title}
              </a>
            ) : (
              <span className="text-fg">{title}</span>
            )}
          </div>
          {links.length > 1 && <LinksMenu links={links} />}
          {work && <LinksEditor part={part} save={save} />}
          {edit && !order && !group && <EditMenu part={part} />}
        </div>
        {showSystem &&
          (highlightSystem ? (
            <div className="-mt-1 self-start truncate rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">{part.systemName}</div>
          ) : (
            <div className="-mt-1.5 truncate text-xs text-subtle">{part.systemName}</div>
          ))}

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <div className="flex min-w-0 max-w-full grow">{order ? <OrderStatusButton part={part} save={save} /> : <StatusField part={part} save={save} />}</div>
          <Price part={part} big={order} />
        </div>

        {!shelfOnThumb && hasShelfTag && (
          <div className="flex min-w-0">
            <ShelfPill part={part} shelf={shelf} save={save} />
          </div>
        )}
        {!struck && <ShelfCoversPrompt part={part} shelf={shelf} save={save} />}
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
  const canRename = useManage();
  const [name, setName] = useState(partTitle(part));
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
    const renamed = canRename && name.trim() && name.trim() !== partTitle(part) ? { displayName: name.trim() } : {};
    onSave({ cotsLinks: links, unitPrice: unit, ...renamed });
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-sm">
      {canRename && (
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-subtle">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input py-1.5" aria-label="Part name" />
        </label>
      )}
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
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      {total == null ? (
        <span className="text-xs whitespace-nowrap text-faint">No price yet</span>
      ) : (
        <span
          className={`font-mono font-bold text-emerald-500 tabular-nums ${big ? "text-lg sm:text-xl" : "text-sm sm:text-base"}`}
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

// What the Order List calls each status: there, "In Order List" reads "To order".
const ORDER_LABELS: Partial<Record<string, string>> = { [COTS_ORDERED]: "To order" };
export const orderLabel = (status: string) => ORDER_LABELS[status] ?? status;
const SEND_BACK_COLOR = "#9ca3af";

// The Order List's big status button: To order, Seen, In Route, In Stock, and a grey Send back that
// asks why and returns the part to Released. `compact` is the table's smaller version.
export function OrderStatusButton({ part, save, compact = false }: { part: CardPart; save: SaveFn; compact?: boolean }) {
  const status = computeStatus(part);
  const color = getCotsStatus(status)?.color ?? "#cbd5e1";
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");
  const locked = !useCan("work");
  const option = "press flex w-full items-center justify-center rounded-xl border-2 border-black/25 py-3 text-base font-bold shadow-sm";
  return (
    <>
      <Popover
        locked={locked}
        hideCaret
        triggerClassName={compact ? "" : "w-full"}
        trigger={
          <span
            className={`flex items-center justify-center gap-2 border-2 border-black/20 font-bold shadow-sm ${compact ? "rounded-full px-3 py-1 text-xs" : "w-full rounded-xl py-3 text-base"}`}
            style={{ background: color, color: textOn(color) }}
          >
            {orderLabel(status)}
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
                  className={`${option} ${s === status ? "ring-2 ring-fg/50 ring-offset-1" : ""}`}
                  style={{ background: c, color: textOn(c) }}
                >
                  {orderLabel(s)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                close();
                setReason("");
                setSendingBack(true);
              }}
              className={option}
              style={{ background: SEND_BACK_COLOR, color: textOn(SEND_BACK_COLOR) }}
            >
              ↩ Send back
            </button>
          </div>
        )}
      </Popover>
      <Dialog open={sendingBack} onClose={() => setSendingBack(false)} title={`Send back ${partTitle(part)}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            save({ status: COTS_RELEASED, cotsSentBack: reason.trim() });
            setSendingBack(false);
          }}
        >
          <p className="text-sm text-muted">It goes back to Released with this note on it.</p>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why? e.g. wrong size, find a cheaper shop…"
            className="input"
            aria-label="Why it is sent back"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setSendingBack(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!reason.trim()}>
              Send back
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
