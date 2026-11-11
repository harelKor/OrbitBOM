import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { effectiveMode } from "@/components/shell/mode";
import { db, schema } from "@/db";
import { listComments, loadSystemReview } from "@/lib/data/cadReview";
import { partKey } from "@/lib/model/assembly";
import { cleanView } from "@/components/viewer/viewState";
import { addComment, canTick, cleanPin, CommentError, tickComments } from "@/lib/reviews/comments";
import { read, uuid, write, ToolError } from "../registry";

const { reviewComments, systems } = schema;

// CAD Review comments (plan/design-review.md): read them as text, add one, tick some off.

const asTool = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CommentError) throw new ToolError(err.message);
    throw err;
  }
};

read(
  "list_review_comments",
  "A system's CAD Review comments (snip: a picture cut from the 3D view with lines drawn on it): state (open; done = ticked off, waiting for a mentor; approved), text, the part it's about, who wrote it and when, a mentor's last rejection note, its pin (x, y, z in assembly mm: the point in the 3D view it was written about) and view (the 3D view it was written in: camera, hidden / isolated parts, section, render mode), and the version tree (Onshape versions, newest first, which ones the BOM was updated to, and the comment ids added and ticked off at each).",
  z.object({ system_id: uuid, state: z.enum(["open", "done", "approved"]).optional() }),
  async ({ system_id, state }) => {
    const review = await loadSystemReview(system_id);
    if (!review) throw new ToolError("Unknown system.");
    return {
      comments: review.comments
        .filter((c) => !state || c.state === state)
        .map((c) => ({ id: c.id, state: c.state, text: c.body, part: c.partName, by: c.author, at: c.createdAt, ticked_by: c.doneBy, approved_by: c.approvedBy, rejected: c.rejectNote ? { note: c.rejectNote, by: c.rejectedBy, at: c.rejectedAt } : null, snip: c.snip ? { picture: c.snip.url, lines: c.snip.strokes.length, changed_by: (c.snip.changed ?? []).map((x) => x.name) } : null, pin: c.pin, view: c.view })),
      versions: review.tree.map((n) => ({ name: n.name, at: n.at, bom: n.bom.map((b) => b.label), bom_current: n.bom.some((b) => b.current), added: n.added, ticked_off: n.done })),
    };
  },
);

write(
  "add_review_comment",
  "Add a CAD Review comment to a system, optionally about one of its parts (part_id from find_parts), with a pin (x, y, z in assembly mm) and a view (as list_review_comments gives one, e.g. copied from another comment). Anyone on the team may.",
  z.object({ system_id: uuid, text: z.string().trim().min(1).max(2000), part_id: uuid.optional(), pin: z.tuple([z.number(), z.number(), z.number()]).optional(), view: z.record(z.string(), z.unknown()).optional() }),
  async ({ system_id, text, part_id, pin, view }, { member }) => {
    const [system] = await db.select({ name: systems.name }).from(systems).where(eq(systems.id, system_id));
    if (!system) throw new ToolError("Unknown system.");
    let part: { key: string; name: string } | null = null;
    if (part_id) {
      const [p] = await db.select().from(schema.parts).where(and(eq(schema.parts.id, part_id), eq(schema.parts.systemId, system_id)));
      if (!p) throw new ToolError("That part isn't in this system.");
      if (!p.sourceDid || !p.sourceEid || !p.onshapePartId) throw new ToolError("That part isn't placed in the 3D model; leave part_id out.");
      part = { key: partKey(p.sourceDid, p.sourceEid, p.onshapePartId), name: p.displayName ?? p.onshapeName ?? "Unnamed part" };
    }
    if (pin && !cleanPin(pin)) throw new ToolError("pin: three numbers in mm, within 100 m.");
    if (view && !cleanView(view)) throw new ToolError("view: not a 3D view (use one list_review_comments gave).");
    return {
      count: 1,
      summary: `Commented on ${system.name}`,
      preview: { system: system.name, part: part?.name ?? null, text, pin: pin ?? null, view: view ? "saved" : null },
      apply: () => asTool(async () => ({ id: (await addComment(member, { systemId: system_id, body: text, partKey: part?.key, partName: part?.name, pin, view })).id })),
    };
  },
);

write(
  "tick_review_comments",
  "Tick off open CAD Review comments of a system (done; a mentor then approves or rejects them). The CAD Team and mentors may.",
  z.object({ system_id: uuid, comment_ids: z.array(uuid).min(1).max(100) }),
  async ({ system_id, comment_ids }, { member }) => {
    const mode = effectiveMode(member);
    if (!canTick(mode, member)) throw new ToolError("Only the CAD Team ticks comments off.");
    const rows = await db
      .select({ id: reviewComments.id, body: reviewComments.body })
      .from(reviewComments)
      .where(and(eq(reviewComments.systemId, system_id), inArray(reviewComments.id, comment_ids), eq(reviewComments.state, "open")));
    return {
      count: rows.length,
      summary: `Ticked off ${rows.length} CAD Review ${rows.length === 1 ? "comment" : "comments"}`,
      preview: rows.map((r) => ({ id: r.id, text: r.body })),
      apply: () => asTool(async () => ({ ticked: await tickComments(member, mode, system_id, rows.map((r) => r.id)), open_left: (await listComments(system_id)).filter((c) => c.state === "open").length })),
    };
  },
);
