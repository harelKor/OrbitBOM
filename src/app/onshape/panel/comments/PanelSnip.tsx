"use client";

import { useEffect, useRef } from "react";
import { SnipOverlay } from "@/components/review/Snip";

// Snip from inside Onshape (Harel, 2026-11-10). The panel is a frame of our site, so it can't read
// Onshape's 3D view; instead the browser shares the screen (the member picks the Onshape tab) and
// one frame is taken, to cut a rectangle from. Where Onshape's frame doesn't allow screen sharing,
// a picture pasted with Ctrl+V (Win+Shift+S, or Cmd+Ctrl+Shift+4 on a Mac) works the same way.

export type Shot = { dataUrl: string; w: number; h: number };

const MAX_SIDE = 2000;

// The picture as a JPEG, cut to `rect` (in its own pixels) and at most MAX_SIDE on a side.
function toJpeg(src: CanvasImageSource, sw: number, sh: number, rect?: { x: number; y: number; w: number; h: number }): Shot {
  const r = rect ?? { x: 0, y: 0, w: sw, h: sh };
  const k = Math.min(1, MAX_SIDE / Math.max(r.w, r.h));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(r.w * k));
  out.height = Math.max(1, Math.round(r.h * k));
  const g = out.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL("image/jpeg", 0.88), w: out.width, h: out.height };
}

// One frame of a shared screen or tab. Throws when the frame isn't allowed to share or the
// member cancels.
export async function captureScreen(): Promise<Shot> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // The first frame can still be black; wait for one more.
    await new Promise((r) => setTimeout(r, 250));
    // Full size here; the crop step makes the JPEG.
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0);
    return { dataUrl: c.toDataURL("image/png"), w: c.width, h: c.height };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

async function loadImage(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// A pasted picture, already cut by the member's own snipping tool.
export async function pastedShot(file: File): Promise<Shot> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return toJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Ctrl+V of a picture anywhere on the page.
export function usePasteShot(onShot: (s: Shot) => void, onError: (msg: string) => void) {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      pastedShot(file).then(onShot, () => onError("That picture couldn't be read."));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onShot, onError]);
}

// The shared screen, full panel: drag the rectangle to keep.
export function CropShot({ shot, onDone, onCancel }: { shot: Shot; onDone: (s: Shot) => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2">
      <div ref={box} className="relative w-full" style={{ aspectRatio: `${shot.w} / ${shot.h}`, maxHeight: "100%", maxWidth: `calc((100dvh - 1rem) * ${shot.w / shot.h})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
        <img src={shot.dataUrl} alt="" className="absolute inset-0 h-full w-full select-none" draggable={false} />
        <SnipOverlay
          onCancel={onCancel}
          onSnip={async (r) => {
            const scale = shot.w / (box.current?.clientWidth || shot.w);
            const img = await loadImage(shot.dataUrl);
            onDone(toJpeg(img, shot.w, shot.h, { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale }));
          }}
        />
      </div>
    </div>
  );
}
