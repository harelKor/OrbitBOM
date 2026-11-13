"use client";

import { useEffect, useRef, useState } from "react";
import type { Recognized } from "@/lib/recognize/answer";
import { countTeethInRing, type TeethResult } from "@/lib/recognize/teeth";
import { jpegOf, ringBox, ringCrop, shrink, type Source } from "./frame";

// The scan test page (plan/item-recognition.md, Phase 0): the live camera with the teeth counter
// drawn over it, Capture sends the photo to Gemini, and everything it answered shows below, with
// the time it took. Pick a photo works too, for photos already on the phone.

type Answer = {
  result: Recognized;
  offers?: { title: string; image: string | null; offers: { vendor: string; url: string; price: number | null }[] }[]; // older answers
  raw: unknown;
  model: string;
  lens?: boolean;
  ms: { model: number; stores?: number; total?: number };
};

const LIVE_SIZE = 320; // the live teeth counter's frame: small, so phones keep up
const STILL_SIZE = 720;
const SEND_SIZE = 768;

export function ScanTest({ configured }: { configured: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [live, setLive] = useState<TeethResult | null>(null);
  const [shot, setShot] = useState<{ url: string; teeth: TeethResult | null } | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The camera, and the teeth counter on a small frame a few times a second.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const work = document.createElement("canvas");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
        if (stopped || !video.current) return stream.getTracks().forEach((t) => t.stop());
        video.current.srcObject = stream;
        await video.current.play();
      } catch {
        setCamError("Couldn't open the camera. Allow camera access for this site, or pick a photo.");
        return;
      }
      const tick = () => {
        const v = video.current;
        const o = overlay.current;
        if (stopped || !v || !o) return;
        const crop = ringCrop(v, LIVE_SIZE, work);
        const r = crop ? countTeethInRing(crop.rgba, crop.size) : null;
        setLive(r);
        o.width = v.clientWidth;
        o.height = v.clientHeight;
        const g = o.getContext("2d")!;
        g.clearRect(0, 0, o.width, o.height);
        if (v.videoWidth) {
          // The aim ring, and the part's edge the counter found inside it.
          const box = ringBox(v.videoWidth, v.videoHeight);
          const k = o.width / v.videoWidth;
          g.lineWidth = 3;
          g.strokeStyle = "rgba(255,255,255,0.8)";
          g.setLineDash([10, 8]);
          g.beginPath();
          g.arc((box.sx + box.side / 2) * k, (box.sy + box.side / 2) * k, (box.side / 2) * k, 0, 2 * Math.PI);
          g.stroke();
          g.setLineDash([]);
          if (r?.teeth) {
            const m = (box.side / LIVE_SIZE) * k;
            g.strokeStyle = "#f97316";
            g.beginPath();
            g.arc(box.sx * k + r.center.x * m, box.sy * k + r.center.y * m, r.radius * m, 0, 2 * Math.PI);
            g.stroke();
            g.fillStyle = "#f97316";
            g.font = "bold 28px system-ui";
            g.textAlign = "center";
            g.fillText(`${r.teeth}T`, box.sx * k + r.center.x * m, box.sy * k + r.center.y * m + 10);
          }
        }
        timer = window.setTimeout(tick, 350);
      };
      tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const send = async (source: Source) => {
    const still = document.createElement("canvas");
    const ring = ringCrop(source, STILL_SIZE, still);
    const big = shrink(source, SEND_SIZE);
    if (!ring || !big) return;
    const teeth = countTeethInRing(ring.rgba, ring.size);
    setShot({ url: seen(still, teeth), teeth });
    setAnswer(null);
    setError(null);
    if (!configured) return setError("The server has no GEMINI_API_KEY yet, so only the teeth counter runs.");
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/recognize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: jpegOf(big), teeth: teeth?.teeth ?? null }),
      });
      const body = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
      if (!res.ok || body.error) setError(body.error ?? `The server answered ${res.status}.`);
      else setAnswer(body as Answer);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      void send(img);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Point the camera at one part. Gears, pulleys and sprockets: flat, from above, on a plain sheet of paper. Photos are sent to Google&apos;s Gemini on its free tier, where Google may
        use them to improve its products: frame only the part.
      </p>
      <div className="panel relative overflow-hidden p-0">
        <video ref={video} className="block h-auto w-full bg-black" muted playsInline />
        <canvas ref={overlay} className="pointer-events-none absolute inset-0" />
        {camError && <p className="p-3 text-sm text-rose-600">{camError}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary min-h-12 px-6 active:scale-[0.98]" disabled={busy || !!camError} onClick={() => video.current && send(video.current)}>
          📷 {busy ? "Reading…" : "Capture"}
        </button>
        <label className="btn min-h-12 cursor-pointer active:scale-[0.98]">
          Pick a photo
          <input type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
        </label>
        <span className="text-sm tabular-nums text-muted">{live?.teeth ? `Live: ${live.teeth} teeth (${Math.round(live.confidence * 100)}%)` : "Live: no teeth seen"}</span>
      </div>

      {shot && (
        <div className="panel space-y-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL */}
          <img src={shot.url} alt="The captured photo" className="max-h-72 rounded-md" />
          <p className="text-sm tabular-nums">
            Teeth counter: {shot.teeth?.teeth ? `${shot.teeth.teeth} teeth, ${Math.round(shot.teeth.confidence * 100)}% sure` : "no teeth"}
            {shot.teeth?.bore ? `, ${shot.teeth.bore} bore` : ""}
            {shot.teeth?.candidates.length ? ` · best counts: ${shot.teeth.candidates.map((c) => `${c.teeth} (${c.score})`).join(", ")}` : ""}
          </p>
          {error && <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
          {answer && <AnswerView answer={answer} />}
        </div>
      )}
    </div>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  const r = answer.result;
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">Category</dt>
        <dd>{r.categoryId ?? "—"}</dd>
        <dt className="text-muted">Name</dt>
        <dd>{r.name || "—"}</dd>
        <dt className="text-muted">Fields</dt>
        <dd>{Object.entries(r.specs).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</dd>
        <dt className="text-muted">Part no.</dt>
        <dd>{r.partNumber ?? "—"}</dd>
        <dt className="text-muted">Read</dt>
        <dd className="break-words">{r.textSeen || "—"}</dd>
        <dt className="text-muted">Sure</dt>
        <dd className="tabular-nums">{Math.round(r.confidence * 100)}%</dd>
        <dt className="text-muted">Or</dt>
        <dd>{r.alternatives.map((a) => `${a.product} (${a.categoryId})`).join(", ") || "—"}</dd>
        <dt className="text-muted">Search</dt>
        <dd>{r.searchQuery ?? "—"}</dd>
        <dt className="text-muted">Time</dt>
        <dd className="tabular-nums">
          {(answer.ms.model / 1000).toFixed(1)} s model · {answer.model}
          {answer.lens ? " · found by photo search (Lens)" : ""}
        </dd>
      </dl>
      {(answer.offers ?? []).length > 0 && (
        <ul className="space-y-1">
          {(answer.offers ?? []).map((g) => (
            <li key={g.title} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- store photos from other sites */}
              {g.image && <img src={g.image} alt="" className="h-10 w-10 rounded object-cover" />}
              <span className="flex-1">{g.title}</span>
              {g.offers[0] && (
                <a href={g.offers[0].url} target="_blank" rel="noreferrer" className="text-accent underline tabular-nums">
                  {g.offers[0].vendor}
                  {g.offers[0].price != null ? ` $${g.offers[0].price}` : ""}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-muted">Raw answer</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(answer.raw, null, 2)}</pre>
      </details>
    </div>
  );
}

// What the counter saw, drawn on the photo: the part's edge it found (orange), the band of
// circles it read the teeth along (dashed), and its centre.
function seen(c: HTMLCanvasElement, r: TeethResult | null) {
  const out = document.createElement("canvas");
  out.width = c.width;
  out.height = c.height;
  const g = out.getContext("2d")!;
  g.drawImage(c, 0, 0);
  if (r) {
    g.lineWidth = Math.max(2, c.width / 300);
    g.strokeStyle = "#f97316";
    g.beginPath();
    g.arc(r.center.x, r.center.y, r.radius, 0, 2 * Math.PI);
    g.stroke();
    g.setLineDash([8, 6]);
    g.strokeStyle = "#22d3ee";
    for (const f of [0.84, 1.05]) {
      g.beginPath();
      g.arc(r.center.x, r.center.y, r.radius * f, 0, 2 * Math.PI);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = "#f97316";
    g.fillRect(r.center.x - 4, r.center.y - 4, 8, 8);
  }
  return out.toDataURL("image/jpeg", 0.85);
}
