// Counts the teeth on a gear, pulley or sprocket in a photo, in the browser, with plain image maths
// (plan/item-recognition.md). AI models guess tooth counts, so this is what the scan trusts.
// Works on a part lying flat, photographed from above, on a plain surface that contrasts with it:
// 1. split the picture into part and background (Otsu's threshold; the background is the side
//    that touches the picture's edge more), keep the biggest piece of part;
// 2. from its centre, the outer edge's distance at many angles = a wavy ring;
// 3. the teeth are that ring's strongest repeat (a Fourier transform), checked by counting bumps;
// 4. the hole in the middle: six corners = hex bore, else round.
// No scale: sizes need the scan mat (Harel, 2026-11-11: don't count on it).

export type TeethResult = {
  teeth: number | null; // null: no clear repeating teeth (not a toothed part, or a bad photo)
  confidence: number; // 0..1
  bore: "hex" | "round" | null;
  center: { x: number; y: number };
  radius: number; // outer radius, pixels
  profile: number[]; // outer radius at each angle (for drawing the outline)
};

const ANGLES = 1024;
const MIN_TEETH = 8;
const MAX_TEETH = 200;

// Grey levels (0..255), one per pixel, row by row.
export function countTeeth(gray: ArrayLike<number>, width: number, height: number): TeethResult | null {
  const n = width * height;
  if (gray.length < n || width < 32 || height < 32) return null;
  const t = otsu(gray, n);
  // Part = the side of the threshold the picture's border mostly isn't.
  let darkBorder = 0;
  let border = 0;
  const edge = (i: number) => {
    border++;
    if (gray[i] <= t) darkBorder++;
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
  for (let i = 0; i < n; i++) mask[i] = (gray[i] <= t) === partIsDark ? 1 : 0;

  const part = biggestPiece(mask, width, height);
  if (!part || part.size < n * 0.01) return null;
  const { label, id } = part;
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (let i = 0; i < n; i++)
    if (label[i] === id) {
      cx += i % width;
      cy += (i / width) | 0;
      count++;
    }
  cx /= count;
  cy /= count;
  // A photo not quite from above squashes the circle into an ellipse, which bunches the teeth up
  // on two sides. The piece's spread (second moments) gives the ellipse; the rays below walk it as
  // if it were round again.
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

  // Outer edge: the farthest part pixel along each ray. Inner edge (the bore): the first part pixel.
  const maxR = Math.hypot(width, height);
  const outer: number[] = [];
  const inner: number[] = [];
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
    outer.push(far);
    inner.push(first < 0 ? 0 : first);
  }
  const radius = mean(outer);
  if (radius < 12) return null;

  const { k, strength, ratio } = strongestRepeat(outer, MIN_TEETH, Math.min(MAX_TEETH, Math.floor(radius * 0.9)));
  // Teeth are real bumps: their wave is at least ~1.5% of the radius, and clearly stronger than
  // any other repeat.
  const depth = strength / radius;
  const bumps = countBumps(outer, k);
  const agree = bumps === k ? 1 : Math.abs(bumps - k) <= 1 ? 0.6 : 0.2;
  const confidence = clamp01(Math.min(1, depth / 0.03) * Math.min(1, (ratio - 1) / 1.5) * agree);
  const teeth = depth > 0.012 && ratio > 1.4 ? k : null;

  let bore: TeethResult["bore"] = null;
  if (holeAtCentre) {
    const hole = mean(inner);
    if (hole > 3 && hole < radius * 0.8) {
      const six = magnitude(inner, 6) / hole;
      const rest = Math.max(magnitude(inner, 4), magnitude(inner, 5), magnitude(inner, 7), magnitude(inner, 8)) / hole;
      bore = six > 0.02 && six > rest * 2 ? "hex" : "round";
    }
  }
  return { teeth, confidence: teeth ? confidence : 0, bore, center: { x: cx, y: cy }, radius, profile: outer };
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function otsu(gray: ArrayLike<number>, n: number) {
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
      const near = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < (height - 1) * width ? i + width : -1];
      for (const j of near)
        if (j >= 0 && mask[j] && !label[j]) {
          label[j] = id;
          stack[top++] = j;
        }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }
  return bestId ? { label, id: bestId, size: bestSize } : null;
}

function magnitude(v: number[], k: number) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < v.length; i++) {
    const th = (2 * Math.PI * k * i) / v.length;
    re += v[i] * Math.cos(th);
    im -= v[i] * Math.sin(th);
  }
  return (2 * Math.hypot(re, im)) / v.length; // the wave's amplitude
}

// The strongest repeat between lo and hi times around. A tooth shape that isn't a pure wave also
// shows at 2k, 3k (harmonics): a k whose half is nearly as strong is really that half.
function strongestRepeat(v: number[], lo: number, hi: number) {
  const m: number[] = [];
  for (let k = 0; k <= hi; k++) m.push(k >= lo ? magnitude(v, k) : 0);
  let k = lo;
  for (let i = lo; i <= hi; i++) if (m[i] > m[k]) k = i;
  for (const d of [2, 3]) if (k % d === 0 && k / d >= lo && m[k / d] > m[k] * 0.5) k = k / d;
  let second = 0;
  // The runner-up, away from k's own neighbours and harmonics.
  for (let i = lo; i <= hi; i++) if (Math.abs(i - k) > 1 && i % k !== 0 && m[i] > second) second = m[i];
  return { k, strength: m[k], ratio: m[k] / (second || 1e-9) };
}

// Bumps above the ring's average after smoothing over a fraction of one tooth.
function countBumps(v: number[], k: number) {
  const w = Math.max(1, Math.floor(v.length / k / 6));
  const s = v.map((_, i) => {
    let t = 0;
    for (let d = -w; d <= w; d++) t += v[(i + d + v.length) % v.length];
    return t / (2 * w + 1);
  });
  const avg = mean(s);
  let bumps = 0;
  let above = s[s.length - 1] > avg;
  for (const x of s) {
    const now = x > avg;
    if (now && !above) bumps++;
    above = now;
  }
  return bumps;
}
