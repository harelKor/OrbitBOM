"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { drawingFromResponse, fetchDrawing } from "@/lib/drawing/download";
import { drawingSvg } from "@/lib/drawing/svg";
import { ZoomStage } from "./ZoomStage";

// A part's drawing as a big picture, to read at the machine. On document.body so a press inside
// doesn't scale the card it was opened from; clicks stop here for the same reason.
export function DrawingPreview({ partId, title, onClose }: { partId: string; title: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [aspect, setAspect] = useState(297 / 210);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDrawing(partId)
      .then((r) => {
        const d = drawingFromResponse(r);
        setAspect(d.sheet.w / d.sheet.h);
        setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawingSvg(d))}`);
      })
      .catch((e: Error) => setError(e.message));
  }, [partId]);

  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Dialog open onClose={onClose} title={`Drawing · ${title}`} width="w-[min(90rem,calc(100vw-2rem))]">
        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : src ? (
          // The whole sheet fits the window; Ctrl + wheel zooms, drag pans.
          <ZoomStage aspect={aspect} className="h-[calc(100dvh-9rem)] rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- drawn here as SVG */}
            <img src={src} alt={`Drawing of ${title}`} draggable={false} className="block h-full w-full select-none rounded-md border border-line bg-white" />
          </ZoomStage>
        ) : (
          <div className="skeleton aspect-[297/210] w-full rounded-md" />
        )}
      </Dialog>
    </div>,
    document.body,
  );
}
