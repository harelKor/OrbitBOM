// A drawing in words, for the MCP tools: the part's sizes, its holes (and which are taps or
// bearing fits) and the notes as the member sees them.

import { BEARINGS, HOLE_MATCH_MM, TAPS } from "@/config/drawings";
import type { DrawingEdits } from "@/db/schema";
import { applyEdits, fmt, partDrawing } from "./layout";
import type { Part } from "./read";
import type { TitleBlock } from "./types";

const near = (a: number, b: number) => Math.abs(a - b) <= HOLE_MATCH_MM;
const mm = (n: number | undefined) => (n == null ? undefined : Number(fmt(n)));

export function drawingSummary(part: Part, edits: DrawingEdits, title: TitleBlock) {
  const base = partDrawing(part, title);
  const shown = applyEdits(base, edits);
  const hidden = new Set(edits.hidden ?? []);
  const sizes =
    part.kind === "plate"
      ? { thickness_mm: mm(part.thickness), outline_mm: [mm(part.front.w), mm(part.front.h)], max_tool_mm: mm(part.minInnerRadius && 2 * part.minInnerRadius) }
      : part.kind === "square-tube"
        ? { size_mm: part.size.map(mm), wall_mm: mm(part.wall), length_mm: mm(part.length), max_tool_mm: mm(part.minInnerRadius && 2 * part.minInnerRadius) }
        : part.kind === "hex-shaft"
          ? { across_flats_mm: mm(part.acrossFlats), bore_mm: mm(part.bore), length_mm: mm(part.length) }
          : { od_mm: mm(part.od), id_mm: mm(part.id), length_mm: mm(part.length) };
  return {
    kind: part.kind,
    ...sizes,
    holes: base.holes.map((h) => ({
      diameter_mm: mm(h.d),
      tap: TAPS.find((t) => near(h.d, t.drillMm))?.note,
      bearing: BEARINGS.find((b) => near(h.d, b.boreMm))?.name,
    })),
    notes: [
      ...base.notes.map((n) => ({ id: n.id, text: edits.text?.[n.id] ?? n.text, hidden: hidden.has(n.id) })),
      ...(edits.added ?? []).map((a) => ({ id: a.id, text: a.text, added: true })),
    ],
    shown_notes: shown.notes.length,
  };
}
