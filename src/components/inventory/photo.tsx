"use client";

import { useRef, useState } from "react";
import { startPhotoUpload } from "@/app/(app)/inventory/actions";
import { Icon } from "@/components/ui/Icon";

const MAX_SIDE = 1200;

// The photo shrunk in the browser (longest side 1200 px, JPEG), so a phone's 12 MP picture
// uploads in a second.
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file isn't a picture this browser can open.");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the picture."))), "image/jpeg", 0.85));
}

// Shrinks and uploads straight to file storage; the item saves the returned key.
export async function uploadPhoto(file: File): Promise<{ key: string; preview: string } | { error: string }> {
  try {
    const blob = await shrink(file);
    const start = await startPhotoUpload();
    if ("error" in start) return start;
    const res = await fetch(start.url, { method: "PUT", body: blob }).catch(() => null);
    if (!res?.ok) return { error: "The upload failed. Check your connection and try again." };
    return { key: start.key, preview: URL.createObjectURL(blob) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// "Take photo" opens the phone's camera straight away; "Upload" picks a file (or a photo from
// the phone's gallery). On a computer both pick a file.
export function PhotoButtons({ onPhoto, compact = false }: { onPhoto: (p: { key: string; preview: string }) => void; compact?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    const r = await uploadPhoto(f);
    setBusy(false);
    if ("error" in r) setError(r.error);
    else onPhoto(r);
  };
  const input = (ref: React.RefObject<HTMLInputElement | null>, capture: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture={capture ? "environment" : undefined}
      className="hidden"
      onChange={(e) => {
        void take(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  const btn = compact ? "btn min-h-9 px-2.5 text-xs" : "btn min-h-11";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {input(camera, true)}
      {input(file, false)}
      <button type="button" className={btn} disabled={busy} onClick={() => camera.current?.click()}>
        📷 {busy ? "Uploading…" : "Take photo"}
      </button>
      <button type="button" className={btn} disabled={busy} onClick={() => file.current?.click()}>
        <Icon name="download" className="h-4 w-4 rotate-180" /> Upload
      </button>
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </div>
  );
}
