"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { drawingFromResponse, fetchDrawing } from "@/lib/drawing/download";
import { drawingSvg } from "@/lib/drawing/svg";

// A part's drawing as a big picture, to read at the machine. On document.body so a press inside
// doesn't scale the card it was opened from; clicks stop here for the same reason.
export function DrawingPreview({ partId, title, onClose }: { partId: string; title: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDrawing(partId)
      .then((r) => setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawingSvg(drawingFromResponse(r)))}`))
      .catch((e: Error) => setError(e.message));
  }, [partId]);

  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Dialog open onClose={onClose} title={`Drawing · ${title}`} width="w-[min(90rem,calc(100vw-2rem))]">
        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn here as SVG
          <img src={src} alt={`Drawing of ${title}`} className="mx-auto max-h-[78vh] w-full rounded-md border border-line bg-white object-contain" />
        ) : (
          <div className="skeleton aspect-[297/210] w-full rounded-md" />
        )}
      </Dialog>
    </div>,
    document.body,
  );
}
