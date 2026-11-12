"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { formatStock } from "@/lib/inventory/stock";
import type { Recognized } from "@/lib/recognize/answer";
import { shelfMatches } from "@/lib/recognize/shelf";
import { countTeeth, type TeethResult } from "@/lib/recognize/teeth";
import { useInventoryPopup } from "./InventoryPopup";
import type { Draft } from "./ItemForm";
import { uploadPhoto } from "./photo";
import { grayOf, jpegOf, shrink } from "./scan/frame";
import type { Item } from "./types";

// Scan anything (plan/item-recognition.md, replaced the barcode-only Scan on 2026-11-11): a
// barcode or SKU still goes into the add box as it is read. Capture sends the photo to the
// recognize route (Gemini, free tier) with the phone's own tooth count; then the part already on
// the shelf opens (Harel, 2026-11-11), several matches are listed, or the add form opens filled
// in and the member only taps Save. The readers load only when the camera opens.
// With show off only the button hides, so a scan already open stays open.

type Answer = { result: Recognized; lens?: boolean; offers: { title: string; image: string | null; offers: { vendor: string; url: string; title: string; image: string | null; price: number | null }[] }[] };

const LIVE_SIZE = 400; // the live teeth counter's frame: small, so phones keep up
const STILL_SIZE = 960; // the captured frame the counter reads: fine teeth need the pixels
const VOTES = 6; // live counts kept; one shows once VOTES_NEEDED of them agree
const VOTES_NEEDED = 3;
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
  const votes = useRef<(number | null)[]>([]);
  const done = useRef(onCode);
  useEffect(() => {
    done.current = onCode;
  });

  // The camera through the barcode reader, and the teeth counter on a small frame a few times a
  // second, drawn over the video.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    let timer = 0;
    const work = document.createElement("canvas");
    const tick = () => {
      const v = video.current;
      const o = overlay.current;
      if (cancelled || !v || !o) return;
      if (!v.paused && v.videoWidth) {
        const c = shrink(v, LIVE_SIZE, work);
        const r = c ? countTeeth(grayOf(c), c.width, c.height) : null;
        votes.current = [...votes.current, r?.teeth && r.confidence > 0.3 ? r.teeth : null].slice(-VOTES);
        const steady = steadyCount(votes.current);
        o.width = v.clientWidth;
        o.height = v.clientHeight;
        const g = o.getContext("2d")!;
        g.clearRect(0, 0, o.width, o.height);
        // Only a count the last few frames agree on shows, so it doesn't flicker.
        if (c && r && steady) drawTeeth(g, r, steady, o.width / c.width);
      }
      timer = window.setTimeout(tick, 350);
    };
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !video.current) return;
        const controls = await new BrowserMultiFormatReader().decodeFromConstraints({ video: { facingMode: "environment", width: { ideal: 1280 } } }, video.current, (result, _err, c) => {
          if (!result) return;
          c.stop();
          done.current(result.getText());
        });
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
        tick();
      } catch {
        setCamError("Couldn't open the camera. Allow camera access for this site, or type the name.");
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, []);

  const capture = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const small = shrink(v, STILL_SIZE);
    const send = shrink(v, SEND_SIZE);
    photo.current = shrink(v, PHOTO_SIZE);
    if (!small || !send) return;
    v.pause();
    overlay.current?.getContext("2d")?.clearRect(0, 0, overlay.current.width, overlay.current.height);
    setStill(send.toDataURL("image/jpeg", 0.8));
    setError(null);
    // The full-size frame's count, else the one the live frames agreed on.
    const frame = countTeeth(grayOf(small), small.width, small.height);
    const teeth = frame?.teeth && frame.confidence > 0.4 ? frame.teeth : steadyCount(votes.current);
    // The photo uploads while the part is recognised; it's used if no store photo turns up.
    const full = photo.current;
    upload.current =
      canAdd && full
        ? new Promise<Blob | null>((ok) => full.toBlob(ok, "image/jpeg", 0.85))
            .then((blob) => (blob ? uploadPhoto(new File([blob], "scan.jpg", { type: "image/jpeg" })) : null))
            .then((up) => (up && !("error" in up) ? up : null))
        : null;
    setBusy("Reading…");
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
    votes.current = [];
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

// The count most of the last live frames agree on, if enough do.
function steadyCount(votes: (number | null)[]): number | null {
  const n = new Map<number, number>();
  for (const v of votes) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  const [best] = [...n].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= VOTES_NEEDED ? best[0] : null;
}

function drawTeeth(g: CanvasRenderingContext2D, r: TeethResult, teeth: number, k: number) {
  g.strokeStyle = "#f97316";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(r.center.x * k, r.center.y * k, r.radius * k, 0, 2 * Math.PI);
  g.stroke();
  g.fillStyle = "#f97316";
  g.font = "bold 28px system-ui";
  g.textAlign = "center";
  g.fillText(`${teeth}T`, r.center.x * k, r.center.y * k + 10);
}
