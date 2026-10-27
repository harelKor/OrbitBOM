"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OPEN_PART_EVENT, OPEN_PART_PENDING, type OpenPartDetail } from "@/components/dashboard/modelEvents";
import { BomProvider, useBom } from "./BomContext";
import type { SaveFn } from "./fields";
import { PartDetails } from "./PartDetails";
import { partIds, type CardPart } from "./types";

type Bom = ReturnType<typeof useBom>;
type Open = { part: CardPart; save: SaveFn; bom: Bom };

const Ctx = createContext<{ openId: string | null; open: (o: Open) => void; sync: (o: Open) => void }>({ openId: null, open: () => {}, sync: () => {} });

// The part details window lives here, once for the whole app, and not inside the card that opened
// it: an edit that moves the card (a new status puts it in another column or section) re-creates
// the card, and the window would close mid-edit. The open card keeps the window's part current.
export function PartDetailsProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null);
  const saveRef = useRef<SaveFn>(() => {});
  const open = useCallback((o: Open) => {
    saveRef.current = o.save;
    setCurrent(o);
  }, []);
  const sync = useCallback((o: Open) => {
    saveRef.current = o.save;
    setCurrent((c) => (c && c.part.id === o.part.id && (c.part !== o.part || c.bom !== o.bom) ? o : c));
  }, []);
  const save = useCallback<SaveFn>((changes) => saveRef.current(changes), []);
  const openId = current?.part.id ?? null;
  const value = useMemo(() => ({ openId, open, sync }), [openId, open, sync]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {current && (
        <BomProvider value={current.bom}>
          <PartDetails part={current.part} save={save} onClose={() => setCurrent(null)} />
        </BomProvider>
      )}
    </Ctx.Provider>
  );
}

// A card's way to open its part's window; while it's open the card hands it every new version of
// the part (and its save, which is bound to the page the card is on). A double-click on the part
// in a 3D view opens it too (OPEN_PART_EVENT), also right after the viewer brought us to its page.
export function usePartDetails(part: CardPart, save: SaveFn) {
  const { openId, open, sync } = useContext(Ctx);
  const bom = useBom();
  const isOpen = openId === part.id;
  const show = useRef(() => open({ part, save, bom }));
  useEffect(() => {
    show.current = () => open({ part, save, bom });
    if (isOpen) sync({ part, save, bom });
  });
  const ids = partIds(part);
  useEffect(() => {
    const mine = ids.split(" ");
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenPartDetail>).detail;
      if (detail.taken || !mine.includes(detail.partId)) return;
      detail.taken = true;
      show.current();
    };
    window.addEventListener(OPEN_PART_EVENT, onOpen);
    try {
      const pending = sessionStorage.getItem(OPEN_PART_PENDING);
      if (pending && mine.includes(pending)) {
        sessionStorage.removeItem(OPEN_PART_PENDING);
        show.current();
      }
    } catch {}
    return () => window.removeEventListener(OPEN_PART_EVENT, onOpen);
  }, [ids]);
  return () => open({ part, save, bom });
}
