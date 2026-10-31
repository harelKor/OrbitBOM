// A part's drawing as a PNG or PDF file, made in the browser from GET /api/parts/[id]/drawing:
// laid out, drawn as SVG, painted onto a 300 dpi A4 canvas. The PDF holds that image on one A4
// landscape page, so no PDF library is needed.

import type { DrawingEdits } from "@/db/schema";
import { applyEdits, partDrawing } from "./layout";
import type { Part } from "./read";
import { drawingSvg } from "./svg";
import type { TitleBlock } from "./types";

const DPI = 300;
const PX_PER_MM = DPI / 25.4;

export type FitPart = { id: string; name: string; thumbUrl: string | null };
export type DrawingResponse = { part: Part; edits: DrawingEdits; title: TitleBlock; outdated: boolean; others: string[]; fitParts: FitPart[] };

export async function fetchDrawing(partId: string): Promise<DrawingResponse> {
  const res = await fetch(`/api/parts/${partId}/drawing`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Couldn't load the drawing.");
  return body;
}

export const drawingFromResponse = (r: DrawingResponse) => applyEdits(partDrawing(r.part, r.title), r.edits);

async function canvasOf(svg: string, w: number, h: number) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * PX_PER_MM);
  canvas.height = Math.round(h * PX_PER_MM);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the image."))), type, quality));

// One page, one JPEG filling it.
export function pdfWithJpeg(jpeg: Uint8Array, px: [number, number], pt: [number, number]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const add = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = size;
    add(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const content = `q ${pt[0]} 0 0 ${pt[1]} 0 0 cm /Im0 Do Q`;
  add("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt[0]} ${pt[1]}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = size;
  add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${px[0]} /Height ${px[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  add(jpeg);
  add("\nendstream\nendobj\n");
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = size;
  add(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export async function downloadDrawing(partId: string, format: "png" | "pdf") {
  const r = await fetchDrawing(partId);
  const d = drawingFromResponse(r);
  const canvas = await canvasOf(drawingSvg(d), d.sheet.w, d.sheet.h);
  const blob =
    format === "png"
      ? await blobOf(canvas, "image/png")
      : pdfWithJpeg(new Uint8Array(await (await blobOf(canvas, "image/jpeg", 0.92)).arrayBuffer()), [canvas.width, canvas.height], [
          Math.round((d.sheet.w / 25.4) * 72 * 100) / 100,
          Math.round((d.sheet.h / 25.4) * 72 * 100) / 100,
        ]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${r.title.name.replace(/[^\w.\- ]+/g, "_")} drawing.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
