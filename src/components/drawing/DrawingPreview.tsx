"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { drawingFromResponse, fetchDrawing, type DrawingResponse } from "@/lib/drawing/download";
import { linkNotes } from "@/lib/drawing/layout";
import { drawingSvg } from "@/lib/drawing/svg";
import { linkTargets, useFitItems, useOpenFitLink } from "./fit";
import { ZoomStage } from "./ZoomStage";

// A part's drawing as a big picture, to read at the machine. On document.body so a press inside
// doesn't scale the card it was opened from; clicks stop here for the same reason. A fit note
// linked to a part or inventory item lights up on hover and opens its window on click.
export function DrawingPreview({ partId, title, onClose }: { partId: string; title: string; onClose: () => void }) {
  const [data, setData] = useState<DrawingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = useFitItems();
  const openFitLink = useOpenFitLink();

  useEffect(() => {
    fetchDrawing(partId)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [partId]);
  const drawing = useMemo(() => (data ? drawingFromResponse(data) : null), [data]);
  const svg = useMemo(() => (drawing && data ? drawingSvg(linkNotes(drawing, linkTargets(data.fitParts ?? [], items)), { live: true }) : null), [drawing, data, items]);

  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Dialog open onClose={onClose} title={`Drawing · ${title}`} width="w-[min(90rem,calc(100vw-2rem))]">
        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : svg && drawing ? (
          // The whole sheet fits the window; Ctrl + wheel zooms, drag pans.
          <ZoomStage aspect={drawing.sheet.w / drawing.sheet.h} className="h-[calc(100dvh-9rem)] rounded-md">
            <div
              role="img"
              aria-label={`Drawing of ${title}`}
              onClick={(e) => openFitLink.fromTarget(e.target)}
              className="h-full w-full select-none overflow-hidden rounded-md border border-line bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </ZoomStage>
        ) : (
          <div className="skeleton aspect-[297/210] w-full rounded-md" />
        )}
      </Dialog>
    </div>,
    document.body,
  );
}
