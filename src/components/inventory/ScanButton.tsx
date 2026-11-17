"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import type { Offer } from "@/lib/inventory/productGroups";
import type { Recognized } from "@/lib/recognize/answer";
import { shelfMatches } from "@/lib/recognize/shelf";
import { combineCounts, type TeethResult } from "@/lib/recognize/teeth";
import { bestOffer, searchStores } from "./AddBox";
import { useInventoryPopup } from "./InventoryPopup";
import type { Draft } from "./ItemForm";
import { uploadPhoto } from "./photo";
import { jpegOf, ringBox, ringCrop, shrink } from "./scan/frame";
import { closeIn, drawLock, type Circle, type LockState } from "./scan/lock";
import { mergeOffers, ScanResults, type LiveSpec, type Pending } from "./scan/ScanResults";
import { startTeethWorker } from "./scan/teethWorker";
import type { InvCategory, Item } from "./types";

// Scan anything (plan/item-recognition.md). A barcode or SKU still goes into the add box as it is
// read. A gear, pulley or sprocket inside the aim ring gets a live green lock with its tooth count
// above it and a button to use it (Harel, 2026-11-13). Capture shows results as they arrive:
// the AI's specs (a card that opens the add window filled in), the items already on the shelf,
// and search results from the stores and the whole web (each opens the add window with that
// product). Nothing opens by itself any more.
// With show off only the button hides, so a scan already open stays open.

const LIVE_SIZE = 288; // the ring's square for the live count
const STILL_SIZE = 720; // the captured ring's square: fine teeth need the pixels
const FRAMES = 8; // live frames voted on
const LIVE_MIN_MS = 90; // live counts run back to back, but not faster than this
const SEND_SIZE = 704;
const PHOTO_SIZE = 1200;

export function ScanButton({
  onCode,
  onNew,
  items,
  categories,
  show = true,
}: {
  onCode: (code: string) => void;
  onNew?: (over: Partial<Draft>) => void;
  items: Item[];
  categories: InvCategory[];
  show?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const canAdd = useCan("work") && !!onNew;
  return (
    <>
      {show && (
        <button
          type="button"
          // mousedown keeps the add box focused, so the button doesn't hide under the tap
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
          className="btn min-h-12 shrink-0 self-start active:scale-[0.98]"
          title="Scan a part, a barcode or a SKU with the camera"
        >
          <span aria-hidden>▥</span> Scan
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Scan">
        {open && (
          <Scanner
            canAdd={canAdd}
            items={items}
            categories={categories}
            onCode={(code) => {
              setOpen(false);
              onCode(code);
            }}
            onNew={(over) => {
              setOpen(false);
              onNew?.(over);
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

type Results = { photo: string | null; live: LiveSpec | null; spec: Pending<Recognized>; stores: Offer[]; web: Pending<Offer[]>; shelf: Item[] };

function Scanner({
  canAdd,
  items,
  categories,
  onCode,
  onNew,
  onClose,
}: {
  canAdd: boolean;
  items: Item[];
  categories: InvCategory[];
  onCode: (code: string) => void;
  onNew: (over: Partial<Draft>) => void;
  onClose: () => void;
}) {
  const { openItem } = useInventoryPopup();
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [saving, setSaving] = useState(false);
  // The live lock's settled reading, shown in the chip above the gear.
  const [locked, setLocked] = useState<LiveSpec | null>(null);
  const lockedRef = useRef<LiveSpec | null>(null);
  const photo = useRef<HTMLCanvasElement | null>(null);
  const upload = useRef<Promise<{ key: string; preview: string } | null> | null>(null);
  const frames = useRef<(TeethResult | null)[]>([]);
  const counter = useRef<ReturnType<typeof startTeethWorker> | null>(null);
  const run = useRef(0); // the current capture; answers from an older one are dropped
  const done = useRef(onCode);
  useEffect(() => {
    done.current = onCode;
  });

  // The camera, a barcode reader on it (the phone's own where it has one, else zxing every 300 ms),
  // the teeth counter inside the aim ring back to back in a worker, and the lock drawn every frame.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let barcodeTimer = 0;
    let frame = 0;
    const work = document.createElement("canvas");
    counter.current = startTeethWorker();
    let shown: Circle | null = null;

    // Where the latest count put the gear, on screen.
    const target = (v: HTMLVideoElement, k: number): { circle: Circle; state: LockState } => {
      const box = ringBox(v.videoWidth, v.videoHeight);
      const ring = { x: (box.sx + box.side / 2) * k, y: (box.sy + box.side / 2) * k, r: (box.side / 2) * k };
      const last = frames.current.at(-1);
      if (!last) return { circle: ring, state: "search" };
      if (last.clipped) return { circle: ring, state: "edge" };
      const m = (box.side / LIVE_SIZE) * k;
      const circle = { x: box.sx * k + last.center.x * m, y: box.sy * k + last.center.y * m, r: last.radius * m };
      if (lockedRef.current) return { circle, state: "lock" };
      // Following something round with a repeat, even before the count settles.
      return last.teeth || last.candidates.length ? { circle, state: "track" } : { circle: ring, state: "search" };
    };

    const paint = (time: number) => {
      if (cancelled) return;
      const v = video.current;
      const o = overlay.current;
      if (v && o && v.videoWidth && !v.paused) {
        if (o.width !== v.clientWidth || o.height !== v.clientHeight) {
          o.width = v.clientWidth;
          o.height = v.clientHeight;
        }
        const g = o.getContext("2d")!;
        g.clearRect(0, 0, o.width, o.height);
        const { circle, state } = target(v, o.width / v.videoWidth);
        // Close in fast: about a quarter of the way each frame.
        shown = shown ? closeIn(shown, circle, state === "lock" ? 0.35 : 0.25) : circle;
        drawLock(g, shown, state, time);
        if (chip.current) {
          chip.current.style.transform = `translate(${shown.x}px, ${Math.max(28, shown.y - shown.r * 1.18)}px) translate(-50%, -100%)`;
          chip.current.style.opacity = state === "lock" ? "1" : "0";
        }
      }
      frame = requestAnimationFrame(paint);
    };

    const count = async () => {
      while (!cancelled) {
        const started = performance.now();
        const v = video.current;
        if (v && !v.paused && v.videoWidth) {
          const crop = ringCrop(v, LIVE_SIZE, work);
          const r = crop ? await counter.current!.count(crop.rgba, crop.size) : null;
          if (cancelled) return;
          frames.current = [...frames.current, r].slice(-FRAMES);
          // A count shows as soon as 3 recent frames agree on it, and goes when they stop.
          const settled = combineCounts(frames.current, 3);
          const bores = frames.current.map((f) => f?.bore).filter(Boolean);
          const bore: LiveSpec["bore"] = bores.length >= 3 ? (bores.filter((b) => b === "hex").length > bores.length / 2 ? "hex" : "round") : null;
          const next: LiveSpec | null = settled.teeth ? { teeth: settled.teeth, bore } : null;
          if (next?.teeth !== lockedRef.current?.teeth || next?.bore !== lockedRef.current?.bore) {
            lockedRef.current = next;
            setLocked(next);
          }
        }
        const wait = LIVE_MIN_MS - (performance.now() - started);
        await new Promise((r) => setTimeout(r, Math.max(16, wait)));
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
        const v = video.current;
        if (cancelled || !v) return stream.getTracks().forEach((t) => t.stop());
        v.srcObject = stream;
        await v.play();
      } catch {
        setCamError("Couldn't open the camera. Allow camera access for this site, or type the name.");
        return;
      }
      frame = requestAnimationFrame(paint);
      void count();
      const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
      const formats = Native ? await Native.getSupportedFormats().catch(() => []) : [];
      if (cancelled) return;
      if (Native && formats.length) {
        const detector = new Native({ formats });
        const look = async () => {
          const v = video.current;
          if (cancelled || !v) return;
          if (!v.paused) {
            const code = (await detector.detect(v).catch(() => []))[0]?.rawValue;
            if (cancelled) return;
            if (code) return done.current(code);
          }
          barcodeTimer = window.setTimeout(look, 250);
        };
        void look();
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !video.current) return;
        const controls = await new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 300 }).decodeFromVideoElement(video.current, (result, _err, c) => {
          if (!result || video.current?.paused) return;
          c.stop();
          done.current(result.getText());
        });
        if (cancelled) controls.stop();
        else stopZxing = () => controls.stop();
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(barcodeTimer);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
      counter.current?.stop();
    };
  }, []);

  // Freeze the frame and keep the full photo (uploaded in the background: it becomes the new
  // item's picture when no store photo is picked).
  const freeze = () => {
    const v = video.current;
    if (!v?.videoWidth) return null;
    const send = shrink(v, SEND_SIZE);
    photo.current = shrink(v, PHOTO_SIZE);
    const ring = ringCrop(v, STILL_SIZE);
    v.pause();
    const full = photo.current;
    upload.current =
      canAdd && full
        ? new Promise<Blob | null>((ok) => full.toBlob(ok, "image/jpeg", 0.85))
            .then((blob) => (blob ? uploadPhoto(new File([blob], "scan.jpg", { type: "image/jpeg" })) : null))
            .then((up) => (up && !("error" in up) ? up : null))
        : null;
    return send ? { send, ring } : null;
  };

  // The live lock's button: its specs straight away, and the web search on the same photo.
  const useLock = () => {
    const live = lockedRef.current;
    const f = freeze();
    if (!live || !f) return;
    const id = ++run.current;
    setResults({ photo: f.send.toDataURL("image/jpeg", 0.7), live, spec: { loading: false, value: null }, stores: [], web: { loading: true, value: null }, shelf: shelfFor(null, live) });
    void searchWeb(id, f.send);
  };

  // Capture: the AI's specs, the web search and (once the AI names a product) the stores, all at
  // once; each fills its part of the results as it answers.
  const capture = async () => {
    const f = freeze();
    if (!f) return;
    const id = ++run.current;
    const live = lockedRef.current;
    setResults({ photo: f.send.toDataURL("image/jpeg", 0.7), live, spec: { loading: true, value: null }, stores: [], web: { loading: true, value: null }, shelf: live ? shelfFor(null, live) : [] });
    void searchWeb(id, f.send);
    // The sharp captured ring counts twice, on top of the live frames.
    const sharp = f.ring ? await (counter.current?.count(f.ring.rgba, f.ring.size) ?? Promise.resolve(null)) : null;
    const teeth = combineCounts([...frames.current, sharp, sharp], 3).teeth ?? live?.teeth ?? null;
    try {
      const res = await fetch("/api/inventory/recognize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: jpegOf(f.send), teeth }) });
      const body = (await res.json().catch(() => ({ error: `The server answered ${res.status}.` }))) as { result?: Recognized; error?: string };
      if (run.current !== id) return;
      if (!res.ok || !body.result) throw new Error(body.error ?? `The server answered ${res.status}.`);
      const r = body.result;
      setResults((s) => s && { ...s, spec: { loading: false, value: r }, shelf: shelfFor(r, live) });
      if (r.name && r.searchQuery) {
        const found = await searchStores(r.searchQuery, AbortSignal.timeout(6000)).catch(() => null);
        if (run.current !== id || !found) return;
        const stores = found.groups.slice(0, 4).map(bestOffer).filter(Boolean);
        setResults((s) => s && { ...s, stores, shelf: shelfFor(r, live, stores) });
      }
    } catch (e) {
      if (run.current !== id) return;
      const error = (e as Error).message === "Failed to fetch" ? "Couldn't reach the server." : (e as Error).message;
      setResults((s) => s && { ...s, spec: { loading: false, value: null, error } });
    }
  };

  const searchWeb = async (id: number, send: HTMLCanvasElement) => {
    try {
      const res = await fetch("/api/inventory/lens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: jpegOf(send) }) });
      const body = (await res.json().catch(() => ({}))) as { offers?: Offer[]; error?: string };
      if (run.current !== id) return;
      setResults((s) => s && { ...s, web: { loading: false, value: body.offers ?? [], error: body.error ?? (res.ok ? null : `The search answered ${res.status}.`) } });
    } catch {
      if (run.current === id) setResults((s) => s && { ...s, web: { loading: false, value: [], error: "Couldn't reach the server." } });
    }
  };

  // Items on the shelf like it: by the AI's product and the store pages it found, or by the
  // live count (any toothed item with that many teeth).
  const shelfFor = (r: Recognized | null, live: LiveSpec | null, stores: Offer[] = []) => {
    const toothed = new Set(categories.filter((c) => c.fields.some((f) => f.id === "teeth")).map((c) => c.id));
    const byAi = r ? shelfMatches(r, stores.map((o) => o.url), items) : [];
    const teeth = r?.specs.teeth ?? (live ? String(live.teeth) : null);
    const byCount = teeth && (!r || r.toothed) ? items.filter((i) => toothed.has(i.category) && i.specs.teeth === teeth && (!r?.categoryId || i.category === r.categoryId)) : [];
    return [...byAi, ...byCount.filter((i) => !byAi.includes(i))].slice(0, 8);
  };

  // The add window; with no store photo picked, the scan's own photo is the item's.
  const addNew = async (draft: Partial<Draft>) => {
    if (!draft.imageUrl && upload.current) {
      setSaving(true);
      const up = await upload.current;
      if (up) draft = { ...draft, photo: up };
    }
    onNew(draft);
  };

  const again = () => {
    run.current++;
    setResults(null);
    frames.current = [];
    lockedRef.current = null;
    setLocked(null);
    void video.current?.play();
  };

  return (
    <div className="space-y-3">
      <div className={`relative overflow-hidden rounded-lg bg-black ${results ? "hidden" : ""}`}>
        <video ref={video} className="block h-auto w-full" muted playsInline />
        <canvas ref={overlay} className="pointer-events-none absolute inset-0" />
        {/* The lock's reading, riding just above the gear. */}
        <div ref={chip} className="absolute top-0 left-0 opacity-0 transition-opacity duration-150" style={{ willChange: "transform" }}>
          {locked && (
            <div className="flex items-center gap-2 rounded-full border border-emerald-400/70 bg-black/75 py-1 pr-1 pl-3 text-sm font-semibold whitespace-nowrap text-emerald-300 shadow-lg backdrop-blur">
              <span className="tabular-nums">
                {locked.teeth}T{locked.bore ? ` · ${locked.bore === "hex" ? "hex" : "round"} bore` : ""}
              </span>
              {canAdd && (
                <button type="button" className="rounded-full bg-emerald-500 px-3 py-1.5 text-white active:scale-[0.96]" onClick={useLock} {...costHint(CALL_COSTS.lens)}>
                  Use →
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {results ? (
        <ScanResults
          photo={results.photo}
          live={results.live}
          spec={results.spec}
          shelf={results.shelf}
          offers={{ loading: results.web.loading, value: mergeOffers(results.stores, results.web.value ?? []), error: results.web.error }}
          categories={categories}
          onNew={(d) => void addNew(d)}
          onOpenItem={(m) => {
            onClose();
            openItem(m.id, m);
          }}
          onAgain={again}
        />
      ) : (
        canAdd && (
          <button type="button" className="btn-primary min-h-12 w-full text-lg active:scale-[0.98]" disabled={!!camError} onClick={() => void capture()} {...costHint(CALL_COSTS.gemini, CALL_COSTS.lens)}>
            📷 Capture
          </button>
        )
      )}
      {saving && <p className="animate-pulse text-sm text-muted">Saving the photo…</p>}
      {/* No how-to text under Capture (Harel, 2026-11-12); only a camera problem shows. */}
      {camError && <p className="text-sm text-rose-600">{camError}</p>}
    </div>
  );
}

// The phone's own barcode reader (Android Chrome); only what Scan uses of it.
type BarcodeDetectorClass = {
  new (o: { formats: string[] }): { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats(): Promise<string[]>;
};
