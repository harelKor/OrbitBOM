"use client";

import { useState } from "react";
import { Popover } from "@/components/bom/Popover";
import type { CardPart } from "@/components/bom/types";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/ui/Toaster";
import { ProductSearch } from "@/components/inventory/ProductSearch";
import { RenameForm } from "./OrderName";

// An inventory item's ⋮ on the order pages (Harel, 2026-11-24): Change name (the order pages'
// name, a part change), Add / Change link (the item's product link, the inventory path, which
// carries it to the order card) and Remove from orders. Members who can work only.
export function ItemOrderMenu({
  part,
  title,
  bomName,
  onRename,
  onRemove,
  overlay = false,
}: {
  part: CardPart;
  title: string;
  bomName: string;
  onRename: (name: string | null) => void;
  onRemove: () => void;
  overlay?: boolean; // on a card's picture: a round dark button
}) {
  const [page, setPage] = useState<"menu" | "rename" | "link">("menu");
  const itemId = part.shelf?.itemId ?? part.inventoryItemId;
  const linked = (part.cotsLinks ?? []).length > 0;
  return (
    <Popover
      align="right"
      hideCaret
      onClosed={() => setPage("menu")}
      width={page === "link" ? 352 : undefined}
      triggerClassName={
        overlay
          ? "press flex h-9 w-9 items-center justify-center rounded-full border border-white/40 bg-[#0D111A]/60 text-white shadow-sm backdrop-blur-md hover:border-sky-400/60 hover:text-sky-300 active:scale-[0.98]"
          : "press flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:w-9"
      }
      trigger={
        <>
          <Icon name="more" className="h-4 w-4" />
          <span className="sr-only">Item options</span>
        </>
      }
    >
      {(close) => {
        if (page === "rename")
          return <RenameForm line={{ title, bomName, renamed: !!part.orderName }} rename={onRename} onDone={close} />;
        if (page === "link" && itemId)
          return (
            <div className="min-h-0 overflow-y-auto">
              <ProductSearch
                itemId={itemId}
                initial={title}
                onMessage={(m) => m && toast(m, true)}
                onLinked={(m) => {
                  close();
                  if (m) toast(m);
                }}
              />
            </div>
          );
        const row = "press flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-fg hover:bg-raised active:scale-[0.98]";
        return (
          <div className="p-0.5">
            <button type="button" className={row} onClick={() => setPage("rename")}>
              <Icon name="pencil" className="h-4 w-4 text-subtle" />
              Change name
            </button>
            {itemId && (
              <button type="button" className={row} onClick={() => setPage("link")}>
                <Icon name="link" className="h-4 w-4 text-subtle" />
                {linked ? "Change link" : "Add link"}
              </button>
            )}
            <button
              type="button"
              className={`${row} text-rose-600 dark:text-rose-300`}
              title="Take it off the order pages; Inventory stays as it is"
              onClick={() => {
                close();
                onRemove();
              }}
            >
              <Icon name="close" className="h-4 w-4" />
              Remove from orders
            </button>
          </div>
        );
      }}
    </Popover>
  );
}
