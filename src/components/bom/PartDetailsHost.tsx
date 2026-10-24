"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BomProvider, useBom } from "./BomContext";
import type { SaveFn } from "./fields";
import { PartDetails } from "./PartDetails";
import type { CardPart } from "./types";

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
// the part (and its save, which is bound to the page the card is on).
export function usePartDetails(part: CardPart, save: SaveFn) {
  const { openId, open, sync } = useContext(Ctx);
  const bom = useBom();
  const isOpen = openId === part.id;
  useEffect(() => {
    if (isOpen) sync({ part, save, bom });
  });
  return () => open({ part, save, bom });
}
