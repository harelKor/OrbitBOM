// The live "target lock" over the camera (Harel, 2026-11-13): a green dotted outline that closes
// in on the gear the counter found and snaps tight once the count settles, like a lock-on in a
// game. Pure drawing; ScanButton moves the circle a little closer to the target every frame.

export type Circle = { x: number; y: number; r: number };
export type LockState = "search" | "edge" | "track" | "lock";

const GREEN = "#22c55e";

// Move a share of the way from a to b: called every frame, it eases in like a closing reticle.
export const closeIn = (a: Circle, b: Circle, share: number): Circle => ({ x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share, r: a.r + (b.r - a.r) * share });

export function drawLock(g: CanvasRenderingContext2D, c: Circle, state: LockState, time: number) {
  g.save();
  if (state === "search" || state === "edge") {
    // The aim ring: where to hold the part (amber while the part crosses its edge).
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.strokeStyle = state === "edge" ? "#facc15" : "rgba(255,255,255,0.75)";
    g.beginPath();
    g.arc(c.x, c.y, c.r, 0, 2 * Math.PI);
    g.stroke();
    g.restore();
    return;
  }
  const locked = state === "lock";
  // Dotted outline, turning slowly while it tracks.
  g.lineWidth = locked ? 4 : 3;
  g.lineCap = "round";
  g.setLineDash([2, locked ? 7 : 10]);
  g.lineDashOffset = locked ? 0 : -time / 40;
  g.strokeStyle = GREEN;
  g.shadowColor = "rgba(34,197,94,0.8)";
  g.shadowBlur = locked ? 12 : 6;
  g.beginPath();
  g.arc(c.x, c.y, c.r * 1.04, 0, 2 * Math.PI);
  g.stroke();
  // Corner brackets: wide while tracking, snapped tight when locked.
  g.setLineDash([]);
  g.lineWidth = locked ? 4 : 3;
  const h = c.r * (locked ? 1.12 : 1.3);
  const arm = Math.max(12, c.r * 0.22);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const x = c.x + sx * h;
    const y = c.y + sy * h;
    g.beginPath();
    g.moveTo(x - sx * arm, y);
    g.lineTo(x, y);
    g.lineTo(x, y - sy * arm);
    g.stroke();
  }
  // A small cross on the centre.
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(c.x - 8, c.y);
  g.lineTo(c.x + 8, c.y);
  g.moveTo(c.x, c.y - 8);
  g.lineTo(c.x, c.y + 8);
  g.stroke();
  g.restore();
}
