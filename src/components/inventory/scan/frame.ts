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
