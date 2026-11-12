"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Snip from inside Onshape (Harel, 2026-11-10). The panel is a frame of our site: it can't read
// Onshape's 3D view, and Onshape's frame doesn't allow screen sharing (tried: getDisplayMedia is
// refused). So the member snips with the system's own tool (Win+Shift+S, Cmd+Ctrl+Shift+4 on a
// Mac) and pastes it here; a picture dragged in or picked as a file works the same. A paste
// needs no permission from the frame.

export type Shot = { dataUrl: string; w: number; h: number };

const MAX_SIDE = 2000;

async function toShot(file: Blob): Promise<Shot> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(img.naturalWidth * k));
    out.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = out.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(img, 0, 0, out.width, out.height);
    return { dataUrl: out.toDataURL("image/jpeg", 0.88), w: out.width, h: out.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const noop = () => () => {};

const imageIn = (files: FileList | null | undefined) => [...(files ?? [])].find((f) => f.type.startsWith("image/"));

// The paste box: Ctrl+V anywhere on the page, a picture dropped on it, or one picked with a tap.
export function SnipPaste({ onShot, onError }: { onShot: (s: Shot) => void; onError: (msg: string) => void }) {
  const [over, setOver] = useState(false);
  // The shortcut for the member's system; the server renders the Windows one.
  const mac = useSyncExternalStore(noop, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);
  const input = useRef<HTMLInputElement>(null);
  const take = (file: Blob | undefined) => {
    if (file) toShot(file).then(onShot, () => onError("That picture couldn't be read."));
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageIn(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      toShot(file).then(onShot, () => onError("That picture couldn't be read."));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onShot, onError]);
  const key = "rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold text-fg";
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(imageIn(e.dataTransfer.files));
      }}
      className={`rounded-lg border-2 border-dashed px-3 py-3 text-center transition-colors ${over ? "border-accent bg-accent/10" : "border-line bg-raised/40"}`}
    >
      <p className="text-sm font-semibold text-fg">📷 Snip the model</p>
      <p className="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-xs text-muted">
        <kbd className={key}>{mac ? "Cmd+Ctrl+Shift+4" : "Win+Shift+S"}</kbd>
        <span>then</span>
        <kbd className={key}>{mac ? "Cmd+V" : "Ctrl+V"}</kbd>
        <span>here</span>
      </p>
      <button type="button" onClick={() => input.current?.click()} className="press mt-1 text-[0.6875rem] text-subtle hover:text-fg hover:underline pointer-coarse:min-h-9">
        or pick a picture
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          take(imageIn(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}
