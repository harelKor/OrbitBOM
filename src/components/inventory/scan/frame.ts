// Camera frames for the scan: a shrunk copy on a canvas, its grey levels for the teeth counter,
// and the JPEG sent to the recognize route (~768 px, ~100 KB, so the server only forwards it).

export type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

const sizeOf = (s: Source) =>
  s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height };

export function shrink(source: Source, max: number, into?: HTMLCanvasElement): HTMLCanvasElement | null {
  const { w, h } = sizeOf(source);
  if (!w || !h) return null;
  const k = Math.min(1, max / Math.max(w, h));
  const c = into ?? document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function grayOf(c: HTMLCanvasElement): Uint8Array {
  const { data } = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  const g = new Uint8Array(c.width * c.height);
  for (let i = 0; i < g.length; i++) g[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  return g;
}

export const jpegOf = (c: HTMLCanvasElement) => c.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, "");

// The aim ring on the camera: a centred circle, 95% of the frame's short side (80% was too tight:
// on Harel's video the gear crossed it on nearly every frame). Only inside it is
// counted (teeth.ts countTeethInRing).
export const RING_SHARE = 0.95;
export function ringBox(w: number, h: number) {
  const side = Math.min(w, h) * RING_SHARE;
  return { sx: (w - side) / 2, sy: (h - side) / 2, side };
}

// The ring's square cut out of the frame at n × n pixels, as RGBA.
export function ringCrop(source: Source, n: number, into?: HTMLCanvasElement): { rgba: Uint8ClampedArray; size: number } | null {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!w || !h) return null;
  const { sx, sy, side } = ringBox(w, h);
  const c = into ?? document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(source, sx, sy, side, side, 0, 0, n, n);
  return { rgba: g.getImageData(0, 0, n, n).data, size: n };
}
