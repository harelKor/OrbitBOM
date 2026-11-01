"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OPEN_PART_EVENT, OPEN_PART_PENDING, type OpenPartDetail } from "@/components/dashboard/modelEvents";
import { loadPartWindow, updatePart } from "@/app/(app)/parts-actions";
import { BomProvider, useBom } from "./BomContext";
import type { SaveFn } from "./fields";
import { PartDetails } from "./PartDetails";
import { partIds, type CardPart } from "./types";

type Bom = ReturnType<typeof useBom>;
type Open = { part: CardPart; save: SaveFn; bom: Bom };

// Fired on window to open a part's window from a page that has no card for it (an inventory
// item's Used in): the provider loads the part and opens it on top of the page. `done` says
// whether it opened.
const OPEN_PART_LOAD_EVENT = "orbit:open-part-load";
type OpenPartLoadDetail = { partId: string; done: (ok: boolean) => void };

// Opens a part's details window where you are: a card for it on this page opens it (with that
// page's save), else the part is loaded.
export function openPartWindow(partId: string): Promise<boolean> {
  const here: OpenPartDetail = { partId, taken: false };
  window.dispatchEvent(new CustomEvent(OPEN_PART_EVENT, { detail: here }));
  if (here.taken) return Promise.resolve(true);
  return new Promise((done) => window.dispatchEvent(new CustomEvent<OpenPartLoadDetail>(OPEN_PART_LOAD_EVENT, { detail: { partId, done } })));
}

const Ctx = createContext<{ openIds: string[]; open: (o: Open) => void; sync: (o: Open) => void }>({ openIds: [], open: () => {}, sync: () => {} });

// The part details window lives here, once for the whole app, and not inside the card that opened
// it: an edit that moves the card (a new status puts it in another column or section) re-creates
// the card, and the window would close mid-edit. The open card keeps the window's part current.
// Windows stack: a part opened from inside another part's window (a fit note on its drawing)
// opens on top, and closing it returns to the window and drawing below (Harel, 2026-11-01).
export function PartDetailsProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Open[]>([]);
  // Each part's latest save, read when the window saves, so a new save doesn't re-render it.
  const saves = useRef(new Map<string, SaveFn>());
  const open = useCallback((o: Open) => {
    saves.current.set(o.part.id, o.save);
    setStack((s) => {
      // The same part on top: show it as given. Another part opens above what's open.
      if (s.at(-1)?.part.id === o.part.id) return [...s.slice(0, -1), o];
      return [...s, o];
    });
  }, []);
  const sync = useCallback((o: Open) => {
    saves.current.set(o.part.id, o.save);
    setStack((s) => {
      let changed = false;
      const next = s.map((c) => {
        if (c.part.id !== o.part.id || (c.part === o.part && c.bom === o.bom)) return c;
        changed = true;
        return o;
      });
      return changed ? next : s;
    });
  }, []);
  // A part loaded on its own: an edit saves it and loads it again, so the window shows the change.
  useEffect(() => {
    const onLoad = async (e: Event) => {
      const { partId, done } = (e as CustomEvent<OpenPartLoadDetail>).detail;
      const first = await loadPartWindow(partId).catch(() => null);
      if (!first) return done(false);
      const bom: Bom = { inventory: [], isAdmin: first.isAdmin, robotId: first.robotId ?? undefined };
      const save: SaveFn = async (changes) => {
        const r = await updatePart(partId, changes).catch(() => ({ error: "Couldn't save. Try again." }));
        if (r.error) alert(r.error);
        const next = await loadPartWindow(partId).catch(() => null);
        if (next) sync({ part: next.part, save, bom });
      };
      open({ part: first.part, save, bom });
      done(true);
    };
    window.addEventListener(OPEN_PART_LOAD_EVENT, onLoad);
    return () => window.removeEventListener(OPEN_PART_LOAD_EVENT, onLoad);
  }, [open, sync]);
  const key = stack.map((o) => o.part.id).join(" ");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids, not the array, decide
  const openIds = useMemo(() => stack.map((o) => o.part.id), [key]);
  const value = useMemo(() => ({ openIds, open, sync }), [openIds, open, sync]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {stack.map((o, i) => (
        // Keyed by place and part: the windows below stay mounted (with any drawing open in them)
        // while one above is open.
        <BomProvider key={`${i}:${o.part.id}`} value={o.bom}>
          <StackedWindow part={o.part} saves={saves} onClose={() => setStack((s) => s.slice(0, i))} />
        </BomProvider>
      ))}
    </Ctx.Provider>
  );
}

function StackedWindow({ part, saves, onClose }: { part: CardPart; saves: React.RefObject<Map<string, SaveFn>>; onClose: () => void }) {
  const id = part.id;
  const save: SaveFn = (changes) => saves.current.get(id)?.(changes);
  return <PartDetails part={part} save={save} onClose={onClose} />;
}

// A card's way to open its part's window; while it's open the card hands it every new version of
// the part (and its save, which is bound to the page the card is on). A double-click on the part
// in a 3D view opens it too (OPEN_PART_EVENT), also right after the viewer brought us to its page.
export function usePartDetails(part: CardPart, save: SaveFn) {
  const { openIds, open, sync } = useContext(Ctx);
  const bom = useBom();
  const isOpen = openIds.includes(part.id);
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
