// Counts the teeth on a gear, pulley or sprocket in a photo, in the browser, with plain image maths
// (plan/item-recognition.md). AI models guess tooth counts, so this is what the scan trusts.
// Works best on a part lying flat, photographed from above, on a plain surface.
// 1. Find the part: split the picture into part and background (Otsu's threshold, after evening
//    out uneven light; the background is the side that touches the picture's edge more), keep the
//    biggest piece; its spread gives the ellipse a photo from the side squashes the circle into.
// 2. Its outer edge's distance at many angles = a wavy ring (the first version read only this).
// 3. Version 2 (Harel, 2026-11-12: real photos fooled the first): also read the picture's
//    brightness along many circles through the teeth. That needs only the centre and the size,
//    not a clean split, so shadows, shine and a busy bench hurt much less. The centre is nudged to
//    where the circles repeat most cleanly.
// 4. The teeth are the strongest repeat of all those rings together (Fourier transforms).
// 5. The hole in the middle: six corners = hex bore, else round.
// No scale: sizes need the scan mat (Harel, 2026-11-11: don't count on it).

export type TeethResult = {
  teeth: number | null; // null: no clear repeating teeth (not a toothed part, or a bad photo)
  confidence: number; // 0..1
  bore: "hex" | "round" | null;
  center: { x: number; y: number };
  radius: number; // outer radius, pixels
  candidates: { teeth: number; score: number }[]; // the best few counts, for the scan test page
};

const ANGLES = 1024; // a power of two, for the FFT
const MIN_TEETH = 8;
const MAX_TEETH = 200;

type Gray = ArrayLike<number>;
type Axes = { cx: number; cy: number; ex: { x: number; y: number }; ey: { x: number; y: number } };

// Grey levels (0..255), one per pixel, row by row.
export function countTeeth(gray: Gray, width: number, height: number): TeethResult | null {
  const n = width * height;
  if (gray.length < n || width < 32 || height < 32) return null;
  const even = evenLight(gray, width, height);
  const t = otsu(even, n);
  // Part = the side of the threshold the picture's border mostly isn't.
  let darkBorder = 0;
  let border = 0;
  const edge = (i: number) => {
    border++;
    if (even[i] <= t) darkBorder++;
  };
  for (let x = 0; x < width; x++) {
    edge(x);
    edge((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    edge(y * width);
    edge(y * width + width - 1);
  }
  const partIsDark = darkBorder < border / 2;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = (even[i] <= t) === partIsDark ? 1 : 0;

  const part = biggestPiece(mask, width, height);
  if (!part || part.size < n * 0.01) return null;
  const { label, id } = part;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++)
    if (label[i] === id) {
      cx += i % width;
      cy += (i / width) | 0;
    }
  cx /= part.size;
  cy /= part.size;
  // A photo not quite from above squashes the circle into an ellipse, which bunches the teeth up
  // on two sides. The piece's spread (second moments) gives the ellipse; everything below walks
  // it as if it were round again.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++)
    if (label[i] === id) {
      const dx = (i % width) - cx;
      const dy = ((i / width) | 0) - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
  const half = (sxx + syy) / 2;
  const spread = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const squash = Math.sqrt((half - spread) / (half + spread || 1));
  const tilt = 0.5 * Math.atan2(2 * sxy, sxx - syy); // the long axis
  const ex = { x: Math.cos(tilt), y: Math.sin(tilt) };
  const ey = { x: -ex.y * squash, y: ex.x * squash };
  const inPart = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < width && yi < height && label[yi * width + xi] === id;
  };

  // Outer edge: the farthest part pixel along each ray. Inner edge (the bore): the first one.
  const maxR = Math.hypot(width, height);
  const outer = new Float64Array(ANGLES);
  const inner = new Float64Array(ANGLES);
  const holeAtCentre = !inPart(cx, cy);
  for (let a = 0; a < ANGLES; a++) {
    const th = (2 * Math.PI * a) / ANGLES;
    const dx = Math.cos(th) * ex.x + Math.sin(th) * ey.x;
    const dy = Math.cos(th) * ex.y + Math.sin(th) * ey.y;
    let far = 0;
    let first = -1;
    for (let r = 0; r < maxR; r += 0.5) {
      const x = cx + dx * r;
      const y = cy + dy * r;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (inPart(x, y)) {
        far = r;
        if (first < 0) first = r;
      }
    }
    outer[a] = far;
    inner[a] = first < 0 ? 0 : first;
  }
  const radius = mean(outer);
  if (radius < 12) return null;
  const hi = Math.min(MAX_TEETH, Math.floor(radius * 0.9), ANGLES / 2 - 1);
  if (hi < MIN_TEETH) return null;

  // The centre where the circles through the teeth repeat most cleanly.
  let axes: Axes = { cx, cy, ex, ey };
  const step = Math.max(0.5, radius * 0.015);
  let bestEnergy = -1;
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const a = { cx: cx + i * step, cy: cy + j * step, ex, ey };
      let e = 0;
      for (const f of [0.9, 0.96, 1]) e += peakShare(spectrum(ring(gray, width, height, a, radius * f)), hi);
      if (e > bestEnergy) {
        bestEnergy = e;
        axes = a;
      }
    }

  // All the rings through the tooth band, each weighted by how cleanly it repeats, plus the outline.
  const score = new Float64Array(hi + 1);
  const rings: Float64Array[] = [];
  for (let f = 0.84; f <= 1.05; f += 0.015) {
    const s = spectrum(ring(gray, width, height, axes, radius * f));
    rings.push(s);
    const q = quality(s, hi);
    if (q < 3) continue; // flat light or plain noise: no repeat in it
    const top = maxOf(s, hi);
    for (let k = MIN_TEETH; k <= hi; k++) score[k] += (q * s[k]) / top;
  }
  const ringMax = maxOf(score, hi);
  const outerSpec = spectrum(outer);
  const outerTop = maxOf(outerSpec, hi);
  const depth = outerTop / radius; // the outline's wave, as a share of the radius
  for (let k = MIN_TEETH; k <= hi; k++) score[k] = (ringMax ? score[k] / ringMax : 0) + (depth > 0.008 && outerTop ? outerSpec[k] / outerTop : 0);

  let k = MIN_TEETH;
  for (let i = MIN_TEETH; i <= hi; i++) if (score[i] > score[k]) k = i;
  // A tooth shape that isn't a pure wave also shows at 2k, 3k: a k whose half or third is nearly
  // as strong is really that.
  for (const d of [2, 3]) if (k % d === 0 && k / d >= MIN_TEETH && score[k / d] > score[k] * 0.6) k = k / d;
  let second = 0;
  for (let i = MIN_TEETH; i <= hi; i++) if (Math.abs(i - k) > 1 && i % k !== 0 && score[i] > second) second = score[i];
  const ratio = score[k] / (second || 1e-9);
  // Real teeth swing the brightness along some ring by a good part of the part-to-background
  // contrast; a plain disc's edge only by its pixel steps (a drawn circle is a bit octagonal).
  let inSum = 0;
  let outSum = 0;
  for (let i = 0; i < n; i++) if (label[i] === id) inSum += gray[i];
  else outSum += gray[i];
  const contrast = Math.abs(inSum / part.size - outSum / Math.max(1, n - part.size));
  const swing = Math.max(...rings.map((s) => s[k]));
  const teeth = ratio > 1.35 && score[k] > 0.5 && (swing > contrast * 0.12 || depth > 0.012) ? k : null;
  const confidence = teeth ? clamp01((ratio - 1) / 1.2) : 0;
  const candidates = [...score.keys()]
    .filter((i) => i >= MIN_TEETH && score[i] > 0)
    .sort((a, b) => score[b] - score[a])
    .slice(0, 4)
    .map((i) => ({ teeth: i, score: Math.round((score[i] / (score[k] || 1)) * 100) / 100 }));

  let bore: TeethResult["bore"] = null;
  if (holeAtCentre) {
    const hole = mean(inner);
    if (hole > 3 && hole < radius * 0.8) {
      const s = spectrum(inner);
      const six = s[6] / hole;
      const rest = Math.max(s[4], s[5], s[7], s[8]) / hole;
      bore = six > 0.02 && six > rest * 2 ? "hex" : "round";
    }
  }
  return { teeth, confidence, bore, center: { x: axes.cx, y: axes.cy }, radius, candidates };
}

const mean = (v: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / (v.length || 1);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const maxOf = (s: ArrayLike<number>, hi: number) => {
  let m = 0;
  for (let k = MIN_TEETH; k <= hi; k++) if (s[k] > m) m = s[k];
  return m;
};

// How much of the ring's repeat the strongest count holds (for nudging the centre).
function peakShare(s: Float64Array, hi: number) {
  let sum = 0;
  for (let k = MIN_TEETH; k <= hi; k++) sum += s[k];
  return sum ? maxOf(s, hi) / sum : 0;
}

// The strongest repeat against the typical one: a clean ring of teeth stands far above.
function quality(s: Float64Array, hi: number) {
  const v = Array.from(s.slice(MIN_TEETH, hi + 1)).sort((a, b) => a - b);
  const median = v[v.length >> 1] || 1e-9;
  return v[v.length - 1] / median;
}

// Brightness along one circle (an ellipse in the photo) around the part's centre, read between
// pixels (bilinear), mean taken off.
function ring(gray: Gray, width: number, height: number, a: Axes, r: number) {
  const out = new Float64Array(ANGLES);
  let sum = 0;
  for (let i = 0; i < ANGLES; i++) {
    const th = (2 * Math.PI * i) / ANGLES;
    const x = a.cx + r * (Math.cos(th) * a.ex.x + Math.sin(th) * a.ey.x);
    const y = a.cy + r * (Math.cos(th) * a.ex.y + Math.sin(th) * a.ey.y);
    const v = bilinear(gray, width, height, x, y);
    out[i] = v;
    sum += v;
  }
  const m = sum / ANGLES;
  for (let i = 0; i < ANGLES; i++) out[i] -= m;
  return out;
}

function bilinear(gray: Gray, width: number, height: number, x: number, y: number) {
  const xc = Math.max(0, Math.min(width - 1.001, x));
  const yc = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const fx = xc - x0;
  const fy = yc - y0;
  const i = y0 * width + x0;
  return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + width] * (1 - fx) + gray[i + width + 1] * fx) * fy;
}

// Each repeat's strength (k times around → s[k]), by a radix-2 FFT; length must be a power of two.
function spectrum(v: ArrayLike<number>): Float64Array {
  const n = v.length;
  const re = Float64Array.from(v);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const out = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) out[k] = (2 * Math.hypot(re[k], im[k])) / n; // the wave's amplitude
  return out;
}

// Uneven light (a lamp on one side, a phone's shadow) evened out: each pixel against a very
// blurred copy of the picture, so one threshold fits everywhere. The blur is wider than the part,
// so the part itself stays whole.
function evenLight(gray: Gray, width: number, height: number): Uint8Array {
  const n = width * height;
  const sat = new Float64Array((width + 1) * (height + 1)); // summed-area table
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + row;
    }
  }
  const r = Math.round(Math.max(width, height) * 0.6);
  let total = 0;
  for (let i = 0; i < n; i++) total += gray[i];
  const avg = total / n;
  const out = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const s = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      const local = s / ((y1 - y0) * (x1 - x0));
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(gray[y * width + x] - local + avg)));
    }
  }
  return out;
}

function otsu(gray: Gray, n: number) {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

// The biggest 4-connected piece of the mask.
function biggestPiece(mask: Uint8Array, width: number, height: number) {
  const label = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let next = 0;
  let bestId = 0;
  let bestSize = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = ++next;
    let top = 0;
    let size = 0;
    stack[top++] = s;
    label[s] = id;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % width;
      const near = (j: number) => {
        if (mask[j] && !label[j]) {
          label[j] = id;
          stack[top++] = j;
        }
      };
      if (x > 0) near(i - 1);
      if (x < width - 1) near(i + 1);
      if (i >= width) near(i - width);
      if (i < (height - 1) * width) near(i + width);
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }
  return bestId ? { label, id: bestId, size: bestSize } : null;
}
