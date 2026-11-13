import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { effectiveMode } from "@/components/shell/mode";
import { db, schema } from "@/db";
import { listComments, loadSystemReview } from "@/lib/data/cadReview";
import { partKey } from "@/lib/model/assembly";
import { cleanView } from "@/components/viewer/viewState";
import { addComment, canApprove, canTick, cleanPin, CommentError, setCommentStatus } from "@/lib/reviews/comments";
import { allowedStatuses, isActive, needsNote } from "@/lib/reviews/status";
import { read, uuid, write, ToolError } from "../registry";

const { reviewComments, systems } = schema;

// CAD Review comments (plan/design-review.md): read them as text, add one, set their status.

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
  "A system's CAD Review comments (snip: a picture cut from the 3D view with lines drawn on it): status (open; on_it = someone is working on it; to_check = waiting for a mentor to check; done = a mentor approved it), text, the part it's about, who wrote it and when, a mentor's last note sending it back, its pin (x, y, z in assembly mm: the point in the 3D view it was written about) and view (the 3D view it was written in: camera, hidden / isolated parts, section, render mode), and the version tree (Onshape versions, newest first, which ones the BOM was updated to, and the comment ids added and set To check or Done at each).",
  z.object({ system_id: uuid, state: z.enum(["open", "on_it", "to_check", "done"]).optional() }),
  async ({ system_id, state }) => {
    const review = await loadSystemReview(system_id);
    if (!review) throw new ToolError("Unknown system.");
    return {
      comments: review.comments
        .filter((c) => !state || c.state === state)
        .map((c) => ({ id: c.id, state: c.state, text: c.body, part: c.partName, by: c.author, at: c.createdAt, on_it_by: c.onItBy, to_check_by: c.doneBy, done_by: c.approvedBy, sent_back: c.rejectNote ? { note: c.rejectNote, by: c.rejectedBy, at: c.rejectedAt } : null, snip: c.snip ? { picture: c.snip.url, lines: c.snip.strokes.length, changed_by: (c.snip.changed ?? []).map((x) => x.name) } : null, pin: c.pin, view: c.view })),
      versions: review.tree.map((n) => ({ name: n.name, at: n.at, bom: n.bom.map((b) => b.label), bom_current: n.bom.some((b) => b.current), added: n.added, checked: n.done })),
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
  "set_review_comment_status",
  "Set the status of CAD Review comments of a system: open, on_it (someone is working on it), to_check (ready for a mentor) or done (approved). The CAD Team, mentors and each comment's author move it between open, on_it and to_check; only mentors (or an admin in Edit mode) set done or take a done one back. A mentor sending a to_check one back to open or on_it gives a note (why it isn't done).",
  z.object({ system_id: uuid, comment_ids: z.array(uuid).min(1).max(100), status: z.enum(["open", "on_it", "to_check", "done"]), note: z.string().trim().max(2000).optional() }),
  async ({ system_id, comment_ids, status, note }, { member }) => {
    const mode = effectiveMode(member);
    const rows = await db
      .select({ id: reviewComments.id, body: reviewComments.body, state: reviewComments.state, authorId: reviewComments.authorId })
      .from(reviewComments)
      .where(and(eq(reviewComments.systemId, system_id), inArray(reviewComments.id, comment_ids)));
    const who = (r: (typeof rows)[number]) => ({ team: canTick(mode, member), approver: canApprove(mode, member), author: r.authorId === member.id });
    const ok = rows.filter((r) => r.state !== status && allowedStatuses(r.state, who(r)).includes(status));
    if (!ok.length) throw new ToolError(rows.length ? "None of those comments can be set to that status by you." : "None of those comments are in this system.");
    if (!note && ok.some((r) => needsNote(r.state, status, { mentor: member.isMentor }))) throw new ToolError("Sending a to_check comment back needs a note: why it isn't done yet.");
    return {
      count: ok.length,
      summary: `Set ${ok.length} CAD Review ${ok.length === 1 ? "comment" : "comments"} to ${status}`,
      preview: ok.map((r) => ({ id: r.id, text: r.body, from: r.state, to: status })),
      apply: () =>
        asTool(async () => {
          for (const r of ok) await setCommentStatus(member, mode, r.id, status, note ?? "");
          return { set: ok.length, still_to_act_on: (await listComments(system_id)).filter((c) => isActive(c.state)).length };
        }),
    };
  },
);
