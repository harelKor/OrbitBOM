import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { OnshapeError } from "@/lib/onshape/client";
import type { DrawingEdits } from "@/db/schema";
import { loadDrawing, makeDrawings } from "@/lib/drawing/make";
import { MARGIN, partDrawing } from "@/lib/drawing/layout";
import { drawingSummary } from "@/lib/drawing/summary";
import { uuid, read, write, ToolError, nameOf } from "../registry";

const { parts } = schema;

// Drawings: reading, making and editing them.

read(
  "get_drawing",
  "member",
  "A part's fabrication drawing: the stock it's read as (plate, square tube, hex shaft or round tube), its exact sizes, every hole with any tap or bearing it matches, and the drawing's notes. Drawings only note taps (Ø4.2 = M5 tapped) and fits; other holes get no note.",
  z.object({ part_id: uuid }),
  async ({ part_id }) => {
    const d = await loadDrawing(part_id);
    if (!d) throw new ToolError("This part has no drawing yet. Make one with create_drawings.");
    return { part: d.title.name, outdated: d.outdated, ...drawingSummary(d.drawing.part, d.drawing.edits, d.title) };
  },
);

write(
  "create_drawings",
  { cap: "draw", destructive: true },
  "Make fabrication drawings for parts of one system from their exact Onshape geometry (2 Onshape calls per Part Studio, with the member's account). Plates, square tubes, hex shafts and round tubes get one; other parts are skipped. Notes added in the editor are kept.",
  z.object({ system_id: uuid, part_ids: z.array(uuid).min(1).max(200) }),
  async ({ system_id, part_ids }, { member }) => {
    const rows = await db
      .select({ id: parts.id, displayName: parts.displayName, onshapeName: parts.onshapeName, partNumber: parts.partNumber })
      .from(parts)
      .where(and(eq(parts.systemId, system_id), inArray(parts.id, part_ids)));
    if (!member.onshapeConnected) throw new ToolError("Connect Onshape on your OrbitParts profile first.");
    return {
      count: rows.length,
      summary: `Made drawings for ${rows.length} ${rows.length === 1 ? "part" : "parts"}`,
      preview: { parts: rows.map(nameOf), note: "Uses 2 of your Onshape API calls per Part Studio." },
      apply: async () => {
        try {
          const s = await makeDrawings(system_id, rows.map((r) => r.id), member.id, Date.now() + 45_000);
          return { made: s.made.length, skipped: s.skipped, left_for_next_call: s.left };
        } catch (err) {
          if (err instanceof OnshapeError) throw new ToolError(err.message);
          throw err;
        }
      },
    };
  },
);

write(
  "edit_drawing",
  { cap: "draw", destructive: true },
  "Change a part's drawing notes: add notes (attached to the first hole of hole_diameter_mm, or free), retype or hide existing ones (ids from get_drawing). Fit notes have three lines, like 'light press fit for' / '1/2IN HEX Bearing' / 'Ø28.7', joined by newlines; fits are light press, heavy press, slip, precise slip.",
  z.object({
    part_id: uuid,
    add: z.array(z.object({ text: z.string().min(1).max(300), hole_diameter_mm: z.number().positive().optional() })).max(20).optional(),
    set_text: z.record(z.string(), z.string().max(300)).optional(),
    hide: z.array(z.string()).optional(),
    show: z.array(z.string()).optional(),
  }),
  async ({ part_id, add, set_text, hide, show }) => {
    const d = await loadDrawing(part_id);
    if (!d) throw new ToolError("This part has no drawing yet. Make one with create_drawings.");
    const layout = partDrawing(d.drawing.part, d.title);
    const edits: DrawingEdits = structuredClone(d.drawing.edits ?? {});
    const hidden = new Set(edits.hidden ?? []);
    hide?.forEach((id) => hidden.add(id));
    show?.forEach((id) => hidden.delete(id));
    edits.hidden = [...hidden];
    for (const [id, text] of Object.entries(set_text ?? {})) {
      const added = edits.added?.find((a) => a.id === id);
      if (added) added.text = text;
      else edits.text = { ...edits.text, [id]: text };
    }
    let n = 0;
    for (const a of add ?? []) {
      const hole = a.hole_diameter_mm ? layout.holes.find((h) => Math.abs(h.d - a.hole_diameter_mm!) <= 0.05) : undefined;
      if (a.hole_diameter_mm && !hole) throw new ToolError(`No Ø${a.hole_diameter_mm} hole on this drawing. get_drawing lists its holes.`);
      const id = `ai:${Date.now()}:${n++}`;
      const at: [number, number] = hole
        ? [Math.min(hole.at[0] + hole.r + 14, layout.sheet.w - 60), Math.max(hole.at[1] - hole.r - 14, 16)]
        : [MARGIN + 5, MARGIN + 10 + 8 * n];
      edits.added = [...(edits.added ?? []), { id, text: a.text, at, ...(hole ? { leader: [hole.at[0] + hole.r * 0.7, hole.at[1] - hole.r * 0.7] as [number, number] } : {}) }];
    }
    const changes = (add?.length ?? 0) + Object.keys(set_text ?? {}).length + (hide?.length ?? 0) + (show?.length ?? 0);
    return {
      count: changes ? 1 : 0,
      summary: `Edited the drawing of ${d.title.name}`,
      preview: { part: d.title.name, notes_after: drawingSummary(d.drawing.part, edits, d.title).notes },
      apply: async () => {
        await db.update(schema.partDrawings).set({ edits, updatedAt: new Date() }).where(eq(schema.partDrawings.partId, part_id));
        return { saved: true };
      },
    };
  },
);
