"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { removePartDrawingFile } from "@/app/(app)/files-actions";
import { upload } from "@/components/bom/FilesField";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { drawingFromResponse, fetchDrawing, type DrawingResponse } from "@/lib/drawing/download";
import { linkNotes } from "@/lib/drawing/layout";
import { drawingSvg } from "@/lib/drawing/svg";
import { linkTargets, useFitItems, useOpenFitLink } from "./fit";
import { syncOnshapeDrawings } from "./syncOnshape";
import { DrawingEditor } from "./DrawingEditor";
import { Notice } from "@/components/ui/Notice";
import { ZoomStage } from "./ZoomStage";
import { askConfirm } from "@/components/ui/useConfirm";

export type DrawingFile = { id: string; filename: string; onshape?: boolean };

// The amber dot on a drawing button whose drawing is older than the part in Onshape.
export function OutdatedDot() {
  return <span aria-hidden className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white bg-amber-500" />;
}
type Source = "file" | "app";

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;
const PDF = /\.pdf$/i;

// A part's drawing as a big picture, to read at the machine: the drawing made in the app, and the
// drawing file (uploaded, or pulled from an Onshape drawing tab), in one window with a switch when
// it has both. The file opens first: it's the official one. Pictures and the app's drawing fit the
// window with Ctrl + wheel zoom and drag to pan; a PDF uses the browser's own viewer.
// On document.body so a press inside doesn't scale the card it was opened from; clicks stop here
// for the same reason. A fit note linked to a part or inventory item lights up on hover and opens
// its window on top of this one, which stays open underneath.
export function DrawingPreview({
  partId,
  systemId,
  title,
  hasDrawing = true,
  file = null,
  onClose,
}: {
  partId: string;
  systemId?: string;
  title: string;
  hasDrawing?: boolean;
  file?: DrawingFile | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const canDraw = useCan("draw");
  const [picked, setPicked] = useState<Source>(file ? "file" : "app");
  // What it has now: after a Delete the page refreshes and the other one shows, or the window closes.
  const source: Source | null = picked === "file" ? (file ? "file" : hasDrawing ? "app" : null) : hasDrawing ? "app" : file ? "file" : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replace = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!source && !busy) onClose();
  }, [source, busy, onClose]);

  // The app's drawing (fetched once it's shown).
  const [data, setData] = useState<DrawingResponse | null>(null);
  const [loads, setLoads] = useState(0); // bumped by Regenerate to fetch the new drawing
  const items = useFitItems();
  const openFitLink = useOpenFitLink();
  const wantApp = source === "app";
  useEffect(() => {
    if (!wantApp) return;
    let live = true;
    fetchDrawing(partId)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [partId, wantApp, loads]);
  const drawing = useMemo(() => (data ? drawingFromResponse(data) : null), [data]);
  const svg = useMemo(() => (drawing && data ? drawingSvg(linkNotes(drawing, linkTargets(data.fitParts ?? [], items)), { live: true }) : null), [drawing, data, items]);

  async function run(label: string, work: () => Promise<string | null | void>) {
    setBusy(label);
    setError(null);
    try {
      const failed = await work();
      if (failed) setError(failed);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const regenerate = () =>
    run("Regenerating…", async () => {
      const res = await fetch(`/api/parts/${partId}/drawing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
      if (!res.ok) return (await res.json().catch(() => ({}))).error ?? "Couldn't regenerate the drawing.";
      setData(null);
      setLoads((n) => n + 1);
    });
  const deleteApp = async () => {
    if (!(await askConfirm({ title: "Delete the app's drawing and its notes?", confirm: "Delete", danger: true }))) return;
    run("Deleting…", async () => {
      const res = await fetch(`/api/parts/${partId}/drawing`, { method: "DELETE" });
      if (!res.ok) return (await res.json().catch(() => ({}))).error ?? "Couldn't delete the drawing.";
      setPicked("file");
    });
  };
  const resync = () =>
    run("Syncing…", async () => {
      if (!systemId) return "Open it from its system to sync it.";
      const r = await syncOnshapeDrawings(systemId, [partId]);
      if (!r.linked.length && !r.unchanged.length) return "No Onshape drawing tab has this part's name any more.";
    });
  const deleteFile = async () => {
    if (!(await askConfirm({ title: `Delete the drawing file ${file?.filename ?? ""}?`, confirm: "Delete", danger: true }))) return;
    run("Deleting…", async () => {
      const r = await removePartDrawingFile(partId);
      setPicked("app");
      return r.error;
    });
  };

  const actions =
    canDraw && source ? (
      <div className="flex items-center gap-1.5">
        {busy && <span className="text-xs text-fg-2">{busy}</span>}
        {source === "app" ? (
          <>
            <button className="btn h-8 text-xs" onClick={() => setEditing(true)} disabled={!!busy || !data} title="Move, retype or hide its notes and dimensions, add new ones">
              Edit
            </button>
            <button className="btn h-8 text-xs" onClick={regenerate} disabled={!!busy} title="Make it again from Onshape (keeps saved notes and dimensions)">
              Regenerate
            </button>
            <button className="btn h-8 text-xs text-rose-600" onClick={deleteApp} disabled={!!busy}>
              Delete
            </button>
          </>
        ) : (
          <>
            {file?.onshape ? (
              <button className="btn h-8 text-xs" onClick={resync} disabled={!!busy} title="Fetch this part's drawing tab from Onshape again (only if it changed)">
                Sync again
              </button>
            ) : (
              <button className="btn h-8 text-xs" onClick={() => replace.current?.click()} disabled={!!busy}>
                Replace
              </button>
            )}
            <button className="btn h-8 text-xs text-rose-600" onClick={deleteFile} disabled={!!busy}>
              Delete
            </button>
            <input
              ref={replace}
              type="file"
              hidden
              accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) run("Uploading…", () => upload({ kind: "part", id: partId }, "drawing", f));
              }}
            />
          </>
        )}
      </div>
    ) : null;

  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Dialog open onClose={onClose} title={`Drawing · ${title}`} actions={actions} width="w-[min(90rem,calc(100vw-2rem))]">
        {file && hasDrawing && (
          <div className="mb-2 inline-flex rounded-md border border-line p-0.5 text-xs" role="tablist">
            {(["file", "app"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={source === s}
                onClick={() => setPicked(s)}
                className={`press rounded px-2.5 py-1 font-medium ${source === s ? "bg-accent text-white" : "text-fg-2 hover:bg-raised"}`}
              >
                {s === "app" ? "App drawing" : file.onshape ? "Onshape drawing" : "Drawing file"}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
        {source === "app" && data?.outdated && (
          // At the machine this matters most: the part was changed after this drawing was made.
          <Notice tone="warning" className="mb-2">
            The part changed in Onshape since this drawing was made, so it may be out of date.{canDraw ? " Regenerate it to update." : " Ask the CAD team to regenerate it."}
          </Notice>
        )}
        {source === "file" && file ? (
          <FileView key={file.id} file={file} title={title} />
        ) : source === "app" && svg && drawing ? (
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
          !error && <div className="skeleton aspect-[297/210] w-full rounded-md" />
        )}
      </Dialog>
      {editing && (
        <DrawingEditor
          partId={partId}
          onClose={() => {
            setEditing(false);
            setData(null);
            setLoads((n) => n + 1);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

// An uploaded or Onshape drawing file: a picture in the zoom stage, a PDF in the browser's viewer.
function FileView({ file, title }: { file: DrawingFile; title: string }) {
  const src = `/api/files/${file.id}`;
  const [aspect, setAspect] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const image = IMAGE.test(file.filename);
  useEffect(() => {
    if (!image) return;
    const img = new Image();
    img.onload = () => setAspect(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 297 / 210);
    img.onerror = () => setFailed(true);
    img.src = src;
  }, [image, src]);

  if (failed) return <p className="text-sm text-rose-700">Couldn&apos;t load {file.filename}.</p>;
  if (image) {
    return aspect ? (
      <ZoomStage aspect={aspect} className="h-[calc(100dvh-9rem)] rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived R2 link */}
        <img src={src} alt={`Drawing of ${title}`} draggable={false} className="h-full w-full select-none rounded-md border border-line bg-white object-contain" />
      </ZoomStage>
    ) : (
      <div className="skeleton aspect-[297/210] w-full rounded-md" />
    );
  }
  if (PDF.test(file.filename)) {
    // Android's Chrome can't show a PDF inside the page: open it in the phone's own viewer.
    if (/Android/i.test(navigator.userAgent)) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-md border border-line p-6 text-center text-sm text-fg-2">
          <p>{file.filename}</p>
          <a className="btn-primary" href={src} target="_blank" rel="noopener">
            Open the PDF
          </a>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <iframe src={`${src}#view=Fit`} title={`Drawing of ${title}`} className="h-[calc(100dvh-11rem)] w-full rounded-md border border-line bg-white" />
        <a className="text-xs text-accent underline" href={src} target="_blank" rel="noopener">
          Open in a new tab
        </a>
      </div>
    );
  }
  return (
    <p className="text-sm text-fg-2">
      {file.filename} can&apos;t be shown here.{" "}
      <a className="text-accent underline" href={`${src}?download=1`}>
        Download it
      </a>
    </p>
  );
}
