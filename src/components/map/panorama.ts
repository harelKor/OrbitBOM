// A zone's 360° picture seen first-person, like Street View (Harel, 2026-11-20). The picture is
// wrapped inside a cylinder (its left edge meets its right edge) with the camera at its centre,
// keeping the picture's pixels square: circumference = picture width, height = picture height.
// Plain maths shared by the WebGL view (PanoramaCanvas), its gestures and whatever is drawn on it
// (drawer tags, PC icons), all in picture coordinates: u across (0..1, wrapping), v down (0..1).

export type Pic = { w: number; h: number };
// Where the camera looks (u may run past 0..1 as you turn round and round) and its vertical field
// of view in degrees.
export type Pano = { u: number; v: number; fov: number };
export type Box = { w: number; h: number };

export const MIN_FOV = 18;
// The opening view: zoomed in like Street View, not the whole picture at once.
export const START_FOV = 65;

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// The shortest way round from a to b, in turns.
export const wrapDelta = (d: number) => d - Math.round(d);
export const mod1 = (u: number) => u - Math.floor(u);

export function cylinder(pic: Pic) {
  const r = pic.w / (2 * Math.PI);
  // The angle from the horizon to the picture's top (or bottom) edge.
  const top = Math.atan(pic.h / 2 / r);
  return { r, H: pic.h, top };
}

// The widest view that still sees only the picture, never past its top or bottom.
export const maxFov = (pic: Pic) => Math.min(100, (2 * cylinder(pic).top) / DEG - 2);
export const startFov = (pic: Pic) => Math.min(START_FOV, maxFov(pic));

export const pitchOf = (v: number, pic: Pic) => {
  const { r, H } = cylinder(pic);
  return Math.atan(((0.5 - v) * H) / r);
};
const vOfPitch = (pitch: number, pic: Pic) => {
  const { r, H } = cylinder(pic);
  return 0.5 - (Math.tan(pitch) * r) / H;
};

// Looking up and down stops where the view's top or bottom reaches the picture's edge.
export function clampPano(p: Pano, pic: Pic): Pano {
  const fov = clamp(p.fov, MIN_FOV, maxFov(pic));
  const room = Math.max(0, cylinder(pic).top - (fov / 2) * DEG);
  const pitch = clamp(pitchOf(p.v, pic), -room, room);
  return { u: p.u, v: vOfPitch(pitch, pic), fov };
}

// The camera's turn (about the vertical) and tilt, as three.js takes them (rotation order YXZ).
export const yawOf = (u: number) => Math.PI - 2 * Math.PI * u;

const focal = (p: Pano, box: Box) => box.h / 2 / Math.tan((p.fov / 2) * DEG);

// A picture point on the cylinder, in world space (the mesh is mirrored so the picture reads
// left to right from inside).
function world(u: number, v: number, pic: Pic): [number, number, number] {
  const { r, H } = cylinder(pic);
  const t = 2 * Math.PI * u;
  return [-r * Math.sin(t), (0.5 - v) * H, r * Math.cos(t)];
}

// A picture point on the screen (px in the box); `front` is false when it's behind you.
export function project(p: Pano, pic: Pic, box: Box, u: number, v: number) {
  const [px, py, pz] = world(u, v, pic);
  const yaw = yawOf(p.u);
  const pitch = pitchOf(p.v, pic);
  const x1 = px * Math.cos(yaw) - pz * Math.sin(yaw);
  const z1 = px * Math.sin(yaw) + pz * Math.cos(yaw);
  const y2 = py * Math.cos(pitch) + z1 * Math.sin(pitch);
  const z2 = -py * Math.sin(pitch) + z1 * Math.cos(pitch);
  const f = focal(p, box);
  const d = Math.max(-z2, 1e-6);
  // Only points well in front count: near 90° off the view a point's place on screen runs off to
  // infinity (and a tag there would cover everything). 0.3 ≈ 72°, wider than any view's edge.
  return { x: box.w / 2 + (f * x1) / d, y: box.h / 2 - (f * y2) / d, front: -z2 > 0.3 * Math.hypot(px, py, pz) };
}

// The picture point under a screen point (px in the box). u comes back nearest the camera's u.
export function unproject(p: Pano, pic: Pic, box: Box, sx: number, sy: number) {
  const f = focal(p, box);
  const xc = (sx - box.w / 2) / f;
  const yc = -(sy - box.h / 2) / f;
  const pitch = pitchOf(p.v, pic);
  const yaw = yawOf(p.u);
  const y1 = yc * Math.cos(pitch) + Math.sin(pitch);
  const z1 = yc * Math.sin(pitch) - Math.cos(pitch);
  const x2 = xc * Math.cos(yaw) + z1 * Math.sin(yaw);
  const z2 = -xc * Math.sin(yaw) + z1 * Math.cos(yaw);
  const { r, H } = cylinder(pic);
  const t = r / Math.max(Math.hypot(x2, z2), 1e-9);
  const u = Math.atan2(-x2 * t, z2 * t) / (2 * Math.PI);
  return { u: p.u + wrapDelta(u - p.u), v: 0.5 - (y1 * t) / H };
}

// A rectangle of the picture (centre and size, 0..1) on the screen: its centre and size in px.
export function projectRect(p: Pano, pic: Pic, box: Box, r: { x: number; y: number; w: number; h: number }) {
  const c = project(p, pic, box, r.x, r.y);
  const l = project(p, pic, box, r.x - r.w / 2, r.y);
  const rt = project(p, pic, box, r.x + r.w / 2, r.y);
  const t = project(p, pic, box, r.x, r.y - r.h / 2);
  const b = project(p, pic, box, r.x, r.y + r.h / 2);
  return { x: c.x, y: c.y, w: Math.abs(rt.x - l.x), h: Math.abs(b.y - t.y), front: c.front && l.front && rt.front };
}

// One finger from `a` to `b` (px in the box): the picture point under it stays under it.
export function dragPano(p: Pano, pic: Pic, box: Box, a: { x: number; y: number }, b: { x: number; y: number }): Pano {
  const from = unproject(p, pic, box, a.x, a.y);
  const to = unproject(p, pic, box, b.x, b.y);
  return clampPano({ ...p, u: p.u + wrapDelta(from.u - to.u), v: p.v + (from.v - to.v) }, pic);
}

// Zoom by `factor` (> 1 closer) about a screen point, which keeps what's under it.
export function zoomPano(p: Pano, pic: Pic, box: Box, factor: number, sx: number, sy: number): Pano {
  const next = clampPano({ ...p, fov: p.fov / factor }, pic);
  const before = unproject(p, pic, box, sx, sy);
  const after = unproject(next, pic, box, sx, sy);
  return clampPano({ ...next, u: next.u + wrapDelta(before.u - after.u), v: next.v + (before.v - after.v) }, pic);
}

// The view that faces these points (their average direction round the circle), as close as
// still shows them all side by side, never wider than the opening view.
export function facing(points: { u: number; v: number }[], pic: Pic, box: Box): Pano {
  if (!points.length) return clampPano({ u: 0.5, v: 0.5, fov: startFov(pic) }, pic);
  const sx = points.reduce((s, q) => s + Math.sin(2 * Math.PI * q.u), 0);
  const cx = points.reduce((s, q) => s + Math.cos(2 * Math.PI * q.u), 0);
  const u = mod1(Math.atan2(sx, cx) / (2 * Math.PI));
  const spread = Math.max(...points.map((q) => Math.abs(wrapDelta(q.u - u))));
  const v = points.reduce((s, q) => s + q.v, 0) / points.length;
  // Horizontal angle that holds them with a margin, as a vertical field of view for this box.
  const half = Math.min(spread * 2 * Math.PI + 12 * DEG, 80 * DEG);
  const fov = (2 * Math.atan(Math.tan(half) / Math.max(box.w / Math.max(box.h, 1), 0.1))) / DEG;
  return clampPano({ u, v, fov: Math.min(fov, startFov(pic)) }, pic);
}
