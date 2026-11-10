import type { Snip, SnipStroke } from "@/db/schema";

// The lines on a comment's snip (Harel, 2026-11-10): anyone draws; the comment's author erases
// any line, everyone else only their own; a member other than the author who changes the lines
// is tagged ("Noa changed").

export const SNIP_COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#111827", "#ffffff"] as const;
const MAX_STROKES = 400;
const MAX_POINTS = 4000;

// Lines as sent from the browser, checked and rounded; `by` is set by the server, never trusted.
export function cleanStrokes(input: unknown, w: number, h: number): Omit<SnipStroke, "by">[] {
  if (!Array.isArray(input)) return [];
  const out: Omit<SnipStroke, "by">[] = [];
  for (const raw of input.slice(0, MAX_STROKES)) {
    const s = raw as Partial<SnipStroke>;
    if (!s || typeof s.c !== "string" || !/^#[0-9a-f]{6}$/i.test(s.c) || !Array.isArray(s.p)) continue;
    const width = Math.min(64, Math.max(1, Math.round(Number(s.s) || 0)));
    const p: number[] = [];
    for (let i = 0; i + 1 < Math.min(s.p.length, MAX_POINTS * 2); i += 2) {
      const x = Number(s.p[i]);
      const y = Number(s.p[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      p.push(Math.round(Math.min(w, Math.max(0, x)) * 10) / 10, Math.round(Math.min(h, Math.max(0, y)) * 10) / 10);
    }
    if (p.length >= 2) out.push({ c: s.c.toLowerCase(), s: width, p });
  }
  return out;
}

// The snip after `member` saved the lines they see. Its author's list replaces every line (they may
// erase anyone's); anyone else's replaces only their own lines, the others' stay as they were.
// `kept`: for the author, the existing lines they kept, by position in the saved list.
export function mergeStrokes(
  snip: Snip,
  member: { id: string; name: string },
  isAuthor: boolean,
  sent: { own: Omit<SnipStroke, "by">[]; keep?: number[] },
  now = new Date(),
): Snip {
  let strokes: SnipStroke[];
  if (isAuthor) {
    const kept = (sent.keep ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < snip.strokes.length).map((i) => snip.strokes[i]);
    strokes = [...kept.filter((s) => s.by !== member.id), ...sent.own.map((s) => ({ ...s, by: member.id }))];
  } else {
    strokes = [...snip.strokes.filter((s) => s.by !== member.id), ...sent.own.map((s) => ({ ...s, by: member.id }))];
  }
  const changed = [...(snip.changed ?? []).filter((c) => c.by !== member.id)];
  if (!isAuthor) changed.push({ by: member.id, name: member.name, at: now.toISOString() });
  return { ...snip, strokes: strokes.slice(0, MAX_STROKES * 4), changed };
}
