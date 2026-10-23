import { inflateSync } from "node:zlib";

// A picture's fingerprint for "same thumbnail" (auto-link): a 64-bit difference hash, as 16 hex
// characters. Two renders of the same part come out within a few bits of each other. Reads the
// PNGs Onshape sends (8-bit grey, RGB, palette or with alpha, not interlaced) with no image
// library; anything else gives null.

type Image = { width: number; height: number; grey: Float64Array };

export function pngGrey(buf: Uint8Array): Image | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  const data: Buffer[] = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const kind = b.toString("latin1", pos + 4, pos + 8);
    const body = b.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === "PLTE") palette = body;
    else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!width || !height || depth !== 8 || interlace || !channels || (type === 3 && !palette) || width * height > 4_000_000) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[out + x - channels] : 0;
      const up = y ? px[out - stride + x] : 0;
      const c = y && x >= channels ? px[out - stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[out + x] = v & 0xff;
    }
  }

  // Grey on white: a transparent background counts as white, like the page shows it.
  const grey = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    let r: number, g: number, bl: number, alpha: number;
    if (type === 3) {
      const p = px[o] * 3;
      [r, g, bl, alpha] = [palette![p], palette![p + 1], palette![p + 2], 255];
    } else if (channels <= 2) [r, g, bl, alpha] = [px[o], px[o], px[o], channels === 2 ? px[o + 1] : 255];
    else [r, g, bl, alpha] = [px[o], px[o + 1], px[o + 2], channels === 4 ? px[o + 3] : 255];
    const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
    grey[i] = (lum * alpha + 255 * (255 - alpha)) / 255;
  }
  return { width, height, grey };
}

// Shrink to 9 × 8 by averaging, then one bit per pair of neighbours: is the left one brighter?
export function dhash(img: Image): string {
  const W = 9;
  const H = 8;
  const small = new Float64Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * img.width) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
      const y0 = Math.floor((y * img.height) / H);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += img.grey[yy * img.width + xx];
      small[y * W + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  let hex = "";
  let nibble = 0;
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W - 1; x++) {
      nibble = (nibble << 1) | (small[y * W + x] > small[y * W + x + 1] ? 1 : 0);
      if (++n % 4 === 0) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  return hex;
}

export function imageHash(buf: Uint8Array): string | null {
  const img = pngGrey(buf);
  return img ? dhash(img) : null;
}

// How many of the 64 bits differ.
export function hashDistance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) for (let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); x; x &= x - 1) n++;
  return n;
}
