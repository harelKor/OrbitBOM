"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { formatStock } from "@/lib/inventory/stock";
import type { Recognized } from "@/lib/recognize/answer";
import { shelfMatches } from "@/lib/recognize/shelf";
import { combineCounts, type TeethResult } from "@/lib/recognize/teeth";
import { useInventoryPopup } from "./InventoryPopup";
import type { Draft } from "./ItemForm";
import { uploadPhoto } from "./photo";
import { jpegOf, ringBox, ringCrop, shrink } from "./scan/frame";
import { startTeethWorker } from "./scan/teethWorker";
import type { Item } from "./types";

// Scan anything (plan/item-recognition.md, replaced the barcode-only Scan on 2026-11-11): a
// barcode or SKU still goes into the add box as it is read. Capture sends the photo to the
// recognize route (Gemini, free tier) with the phone's own tooth count; then the part already on
// the shelf opens (Harel, 2026-11-11), several matches are listed, or the add form opens filled
// in and the member only taps Save. The readers load only when the camera opens.
// With show off only the button hides, so a scan already open stays open.

type Answer = { result: Recognized; lens?: boolean; offers: { title: string; image: string | null; offers: { vendor: string; url: string; title: string; image: string | null; price: number | null }[] }[] };

// Gears: the count is read inside the aim ring, off the page's thread, about three times a second,
// and shows only once the last frames together settle on it (Harel's video, 2026-11-12).
const LIVE_SIZE = 320; // the ring's square for the live count
const STILL_SIZE = 720; // the captured ring's square: fine teeth need the pixels
const FRAMES = 10; // live frames added together
const LIVE_MS = 300;
const SEND_SIZE = 768;
const PHOTO_SIZE = 1200;

export function ScanButton({ onCode, onNew, items, show = true }: { onCode: (code: string) => void; onNew?: (over: Partial<Draft>) => void; items: Item[]; show?: boolean }) {
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

function Scanner({ canAdd, items, onCode, onNew, onClose }: { canAdd: boolean; items: Item[]; onCode: (code: string) => void; onNew: (over: Partial<Draft>) => void; onClose: () => void }) {
  const { openItem } = useInventoryPopup();
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [still, setStill] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ matches: Item[]; draft: Partial<Draft> } | null>(null);
  const photo = useRef<HTMLCanvasElement | null>(null);
  const upload = useRef<Promise<{ key: string; preview: string } | null> | null>(null);
  const frames = useRef<(TeethResult | null)[]>([]);
  const counter = useRef<ReturnType<typeof startTeethWorker> | null>(null);
  const done = useRef(onCode);
  useEffect(() => {
    done.current = onCode;
  });

  // The camera, a barcode reader on it (the phone's own where it has one, else zxing, both a few
  // times a second instead of every frame), and the teeth counter inside the aim ring.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let timer = 0;
    let barcodeTimer = 0;
    const work = document.createElement("canvas");
    counter.current = startTeethWorker();
    const draw = () => {
      const v = video.current;
      const o = overlay.current;
      if (!v || !o || !v.videoWidth) return;
      o.width = v.clientWidth;
      o.height = v.clientHeight;
      const g = o.getContext("2d")!;
      g.clearRect(0, 0, o.width, o.height);
      if (v.paused) return;
      drawRing(g, ringBox(v.videoWidth, v.videoHeight), o.width / v.videoWidth, combineCounts(frames.current).teeth);
    };
    const tick = async () => {
      const v = video.current;
      if (cancelled || !v) return;
      if (!v.paused && v.videoWidth) {
        const crop = ringCrop(v, LIVE_SIZE, work);
        const r = crop ? await counter.current!.count(crop.rgba, crop.size) : null;
        if (cancelled) return;
        frames.current = [...frames.current, r].slice(-FRAMES);
        draw();
      }
      timer = window.setTimeout(tick, LIVE_MS);
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
      void tick();
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
      clearTimeout(timer);
      clearTimeout(barcodeTimer);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
      counter.current?.stop();
    };
  }, []);

  const capture = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const ring = ringCrop(v, STILL_SIZE);
    const send = shrink(v, SEND_SIZE);
    photo.current = shrink(v, PHOTO_SIZE);
    if (!ring || !send) return;
    v.pause();
    overlay.current?.getContext("2d")?.clearRect(0, 0, overlay.current.width, overlay.current.height);
    setStill(send.toDataURL("image/jpeg", 0.8));
    setError(null);
    // The photo uploads while the part is recognised; it's used if no store photo turns up.
    const full = photo.current;
    upload.current =
      canAdd && full
        ? new Promise<Blob | null>((ok) => full.toBlob(ok, "image/jpeg", 0.85))
            .then((blob) => (blob ? uploadPhoto(new File([blob], "scan.jpg", { type: "image/jpeg" })) : null))
            .then((up) => (up && !("error" in up) ? up : null))
        : null;
    setBusy("Reading…");
    // The sharp captured ring counts twice, on top of the live frames.
    const sharp = await (counter.current?.count(ring.rgba, ring.size) ?? Promise.resolve(null));
    const settled = combineCounts([...frames.current, sharp, sharp]);
    const teeth = settled.teeth ?? (sharp?.teeth && sharp.confidence > 0.5 ? sharp.teeth : null);
    try {
      const res = await fetch("/api/inventory/recognize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: jpegOf(send), teeth }),
      });
      const body = (await res.json().catch(() => ({ error: `The server answered ${res.status}.` }))) as Answer & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `The server answered ${res.status}.`);
      await finish(body);
    } catch (e) {
      setError((e as Error).message === "Failed to fetch" ? "Couldn't reach the server." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // What it found → the item on the shelf, a choice, or the add form filled in.
  const finish = async ({ result: r, offers, lens }: Answer) => {
    // A store's product only counts for a known product (a gear's search finds any gear), or one
    // the web search found from the photo itself.
    const group = r.name || lens ? offers[0] : undefined;
    const best = group?.offers[0];
    const matches = shelfMatches(r, group?.offers.map((o) => o.url) ?? [], items);
    if (matches.length === 1) {
      onClose();
      openItem(matches[0].id, matches[0]);
      return;
    }
    const draft: Partial<Draft> = {
      category: r.categoryId,
      specs: r.specs,
      ...(r.name || best ? { name: r.name || best!.title, nameTouched: true } : {}),
      links: best ? [{ url: best.url, site: best.vendor }] : [],
      price: best?.price ?? null,
      imageUrl: best?.image ?? group?.image ?? null,
    };
    if (matches.length) return setChoices({ matches, draft });
    await addNew(draft);
  };

  // No store photo: the scan's own photo becomes the item's.
  const addNew = async (draft: Partial<Draft>) => {
    if (!draft.imageUrl && upload.current) {
      setBusy("Saving the photo…");
      const up = await upload.current;
      if (up) draft = { ...draft, photo: up };
    }
    onNew(draft);
  };

  const again = () => {
    setStill(null);
    setError(null);
    setChoices(null);
    frames.current = [];
    void video.current?.play();
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} className={`block h-auto w-full ${still ? "hidden" : ""}`} muted playsInline />
        <canvas ref={overlay} className={`pointer-events-none absolute inset-0 ${still ? "hidden" : ""}`} />
        {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL */}
        {still && <img src={still} alt="The captured photo" className="block h-auto w-full" />}
      </div>

      {choices ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Already on the shelf?</p>
          {choices.matches.map((m) => (
            <button
              key={m.id}
              type="button"
              className="btn min-h-12 w-full justify-start text-left active:scale-[0.98]"
              onClick={() => {
                onClose();
                openItem(m.id, m);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="shrink-0 tabular-nums text-muted">{`${formatStock(m.inStock, m.sheet)} ${m.sheet ? "sheets" : "in stock"}`}</span>
            </button>
          ))}
          {canAdd && (
            <button type="button" className="btn-primary min-h-12 w-full active:scale-[0.98]" disabled={!!busy} onClick={() => void addNew(choices.draft)}>
              {busy ?? "+ It's a new item"}
            </button>
          )}
        </div>
      ) : (
        <>
          {canAdd && (
            <button type="button" className="btn-primary min-h-12 w-full text-lg active:scale-[0.98]" disabled={!!busy || !!camError || !!still} onClick={() => void capture()}>
              {busy ?? "📷 Capture"}
            </button>
          )}
          {error && (
            <div className="space-y-2">
              <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>
              <div className="flex gap-2">
                <button type="button" className="btn min-h-11 flex-1 active:scale-[0.98]" onClick={again}>
                  Try again
                </button>
                <button type="button" className="btn min-h-11 flex-1 active:scale-[0.98]" onClick={() => void addNew({})}>
                  Add by hand
                </button>
              </div>
            </div>
          )}
          {/* No how-to text under Capture (Harel, 2026-11-12); only a camera problem shows. */}
          {camError && <p className="text-sm text-rose-600">{camError}</p>}
        </>
      )}
    </div>
  );
}

// The phone's own barcode reader (Android Chrome); only what Scan uses of it.
type BarcodeDetectorClass = {
  new (o: { formats: string[] }): { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats(): Promise<string[]>;
};

// The aim ring: where to hold the gear. It turns orange with the count once the frames settle.
function drawRing(g: CanvasRenderingContext2D, box: { sx: number; sy: number; side: number }, k: number, teeth: number | null) {
  const x = (box.sx + box.side / 2) * k;
  const y = (box.sy + box.side / 2) * k;
  const r = (box.side / 2) * k;
  g.lineWidth = 3;
  g.setLineDash(teeth ? [] : [10, 8]);
  g.strokeStyle = teeth ? "#f97316" : "rgba(255,255,255,0.8)";
  g.beginPath();
  g.arc(x, y, r, 0, 2 * Math.PI);
  g.stroke();
  g.setLineDash([]);
  if (teeth) {
    g.font = "bold 32px system-ui";
    g.textAlign = "center";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeText(`${teeth}T`, x, y + r - 18);
    g.fillStyle = "#f97316";
    g.fillText(`${teeth}T`, x, y + r - 18);
  }
}
