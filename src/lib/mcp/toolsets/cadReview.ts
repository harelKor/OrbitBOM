import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { effectiveMode } from "@/components/shell/mode";
import { db, schema } from "@/db";
import { listComments, loadSystemReview } from "@/lib/data/cadReview";
import { partKey } from "@/lib/model/assembly";
import { cleanView } from "@/components/viewer/viewState";
import { addComment, addReply, canApprove, canTick, cleanPin, CommentError, setCommentStatus } from "@/lib/reviews/comments";
import { allowedStatuses, isActive, needsNote } from "@/lib/reviews/status";
import { anchorKindName } from "@/lib/reviews/anchor";
import { finishDesignReview, listDesignReviews, openDesignReview, reviewName, setCommentReview, startDesignReview } from "@/lib/reviews/designReviews";
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
  "member",
  "A system's CAD Review comments (snip: a picture cut from the 3D view with lines drawn on it): status (open; on_it = someone is working on it; to_check = waiting for a mentor to check; done = a mentor approved it), text, the part it's about, who wrote it and when, the version it is on, its replies (a thread like Onshape's; a mentor sending it back writes why there), its pin (x, y, z in assembly mm: the point in the 3D view it was written about), linked_to (the face, edge or point of its part it's about, when one was picked), design_review (the Design Review it belongs to; design_review_id filters to one) and view (the 3D view it was written in: camera, hidden / isolated parts, section, edges on or off), and the version tree (Onshape versions, newest first, which ones the BOM was updated to, and the comment ids added and set To check or Done at each).",
  z.object({ system_id: uuid, state: z.enum(["open", "on_it", "to_check", "done"]).optional(), design_review_id: uuid.optional() }),
  async ({ system_id, state, design_review_id }) => {
    const review = await loadSystemReview(system_id);
    if (!review) throw new ToolError("Unknown system.");
    return {
      comments: review.comments
        .filter((c) => (!state || c.state === state) && (!design_review_id || c.designReview?.id === design_review_id))
        .map((c) => ({ id: c.id, state: c.state, text: c.body, part: c.partName, by: c.author, at: c.createdAt, on_it_by: c.onItBy, to_check_by: c.doneBy, done_by: c.approvedBy, version: c.version?.name ?? null, edited: c.editedAt, replies: c.replies.map((r) => ({ text: r.body, by: r.author, at: r.createdAt, edited: r.editedAt })), snip: c.snip ? { picture: c.snip.url, lines: c.snip.strokes.length, changed_by: (c.snip.changed ?? []).map((x) => x.name) } : null, pin: c.pin, design_review: c.designReview ? { id: c.designReview.id, name: c.designReview.name, robot_version: c.designReview.version } : null, linked_to: c.anchor ? { what: anchorKindName(c.anchor).toLowerCase(), part: c.partName, at_mm: c.anchor.at } : null, view: c.view })),
      versions: review.tree.map((n) => ({ name: n.name, at: n.at, bom: n.bom.map((b) => b.label), bom_current: n.bom.some((b) => b.current), added: n.added, checked: n.done })),
    };
  },
);

write(
  "add_review_comment",
  { cap: "member", destructive: false },
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
  { cap: "member", destructive: true },
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

write(
  "reply_to_review_comment",
  { cap: "member", destructive: false },
  "Reply in a CAD Review comment's thread (comment_id from list_review_comments). Anyone on the team may. part_key / part_name link a part (keys as list_review_comments gives them).",
  z.object({ comment_id: uuid, text: z.string().trim().min(1).max(2000), part_key: z.string().max(300).optional(), part_name: z.string().max(200).optional() }),
  async ({ comment_id, text, part_key, part_name }, { member }) => {
    const [c] = await db.select({ body: reviewComments.body }).from(reviewComments).where(eq(reviewComments.id, comment_id));
    if (!c) throw new ToolError("Unknown comment.");
    return {
      count: 1,
      summary: "Replied to a CAD Review comment",
      preview: { comment: c.body, reply: text, ...(part_key ? { part: part_name ?? part_key } : {}) },
      apply: () => asTool(async () => ({ id: (await addReply(member, comment_id, text, { partKey: part_key ?? null, partName: part_name ?? null })).id })),
    };
  },
);

read(
  "get_design_check",
  "member",
  "A robot's newest Design check (plan/design-check.md: run by the CAD Team on the CAD page, from the 3D model): when and by whom, the limits set, weight (total, by system, the heaviest parts, ones whose weight is a guess), frame perimeter / size / height and parts past the frame perimeter, overlapping parts (depth in mm, the usual kinds such as screws in tapped holes marked), and every other finding (not attached, holes that don't line up, hole sizes, screw length and thread, hard to reach, held by one screw, plates, printed parts) with its parts, plain-words text, level (warn / info), a point in assembly mm, and the AI write-up if one was made. Findings and overlaps marked fine are left out. robot_id from list_robots.",
  z.object({ robot_id: uuid, model: z.enum(["final", "basepart"]).optional() }),
  async ({ robot_id, model }) => {
    const { loadCheckData } = await import("@/lib/check/store");
    const { pairKey } = await import("@/lib/check/types");
    const data = await loadCheckData(robot_id, model ?? "final");
    if (!data) throw new ToolError("Unknown robot.");
    if (!data.latest) return { ran: false, note: "Nobody has run the design check on this robot's model yet (CAD page → Design check → Run the check)." };
    const r = data.latest.results;
    const fine = new Set(data.ignored);
    const names = new Map((await db.select({ id: systems.id, name: systems.name }).from(systems).where(eq(systems.robotId, robot_id))).map((s) => [s.id, s.name]));
    return {
      ran_at: data.latest.ranAt,
      ran_by: data.latest.ranBy,
      limits: data.limits,
      weight: {
        total_kg: r.weight.totalG / 1000,
        by_system: r.weight.bySystem.map((s) => ({ system: s.systemId ? (names.get(s.systemId) ?? s.systemId) : null, kg: s.g / 1000, budget_kg: s.systemId ? (data.limits.budgets?.[s.systemId] ?? null) : null })),
        heaviest: r.weight.parts.slice(0, 15).map((p) => ({ part: p.name, each_g: p.eachG, count: p.count, source: p.source })),
        guessed: r.weight.parts.filter((p) => p.source === "guess").map((p) => p.name),
      },
      size: r.envelope && { perimeter_mm: r.envelope.perimeterMm, length_mm: r.envelope.lengthMm, width_mm: r.envelope.widthMm, height_mm: r.envelope.heightMm, past_frame: r.envelope.out },
      overlaps: r.clashes.filter((c) => !fine.has(pairKey(c.a, c.b))).map((c) => ({ a: c.aName, b: c.bName, depth_mm: c.depthMm, places: c.copies, usual_kind: c.expected, side_by_side: !!c.flush, placed_twice: !!c.same, at_mm: c.at })),
      findings: (r.findings ?? []).filter((f) => !fine.has(f.id)).map((f) => ({ kind: f.kind, level: f.level, text: f.text, parts: f.names, places: f.copies, at_mm: f.at, likely_fix: r.ai?.fixes[f.id] ?? null })),
      ai_summary: r.ai?.summary ?? null,
    };
  },
);

// Design Reviews (plan/cad-design-review.md, Harel 2026-11-18).
read(
  "list_design_reviews",
  "member",
  "A robot's Design Reviews (DRs), newest first: name (DR 3), whether it's still open, the whole robot or which systems, its State text (what was being reviewed and where it was at), the robot version it started on and the one made when it finished (if any), who started / finished it and when, and its comments (id, system, status, text). Comments written while a DR is open on its systems (or the whole robot) join it. robot_id from list_robots.",
  z.object({ robot_id: uuid }),
  async ({ robot_id }) => {
    const [reviews, comments] = await Promise.all([listDesignReviews(robot_id), listComments({ robotId: robot_id })]);
    return reviews.map((d) => ({
      id: d.id,
      name: d.name,
      open: d.open,
      systems: d.wholeRobot ? "whole robot" : d.systems.map((x) => x.name),
      state: d.state,
      robot_version: d.version,
      finish_version: d.finishVersion,
      started_by: d.startedBy,
      started_at: d.startedAt,
      finished_by: d.finishedBy,
      finished_at: d.finishedAt,
      comments: comments.filter((c) => c.designReview?.id === d.id).map((c) => ({ id: c.id, system: c.systemName ?? "whole robot", status: c.state, text: c.body, part: c.partName })),
    }));
  },
);

const adminOnly = (member: { isAdmin: boolean }) => {
  if (!member.isAdmin) throw new ToolError("Only an admin starts or finishes a Design Review.");
};

write(
  "start_design_review",
  { cap: "manage", destructive: false },
  "Start a Design Review (DR) on a robot (admins only; one open per robot): the whole robot, or system_ids. state: what's being reviewed and where it's at. It's tagged with the robot's newest robot version (none is made). Comments written while it's open on its systems (or the whole robot) join it.",
  z.object({ robot_id: uuid, state: z.string().trim().min(1).max(2000), system_ids: z.array(uuid).min(1).max(50).optional() }),
  async ({ robot_id, state, system_ids }, { member }) => {
    adminOnly(member);
    const open = await openDesignReview(robot_id);
    if (open) throw new ToolError(`${reviewName(open.seq)} is already open on this robot: finish it first.`);
    return {
      count: 1,
      summary: "Started a Design Review",
      preview: { systems: system_ids?.length ? system_ids : "whole robot", state },
      apply: () => asTool(async () => ({ id: (await startDesignReview(member, robot_id, { wholeRobot: !system_ids?.length, systemIds: system_ids, state })).id })),
    };
  },
);

write(
  "finish_design_review",
  { cap: "manage", destructive: false },
  "Finish the robot's open Design Review (admins only). create_version: also make a robot version for it (named version_name, default R<next>), which keeps every system's 3D model as it is now (no Onshape calls).",
  z.object({ robot_id: uuid, create_version: z.boolean().optional(), version_name: z.string().trim().max(120).optional() }),
  async ({ robot_id, create_version, version_name }, { member }) => {
    adminOnly(member);
    const open = await openDesignReview(robot_id);
    if (!open) throw new ToolError("No Design Review is open on this robot.");
    return {
      count: 1,
      summary: `Finished ${reviewName(open.seq)}`,
      preview: { design_review: reviewName(open.seq), state: open.state, new_robot_version: create_version ? version_name || "R<next>" : null },
      apply: () => asTool(async () => ({ id: (await finishDesignReview(member, robot_id, { version: create_version ? (version_name ?? "") : null })).id })),
    };
  },
);

write(
  "set_comment_design_review",
  { cap: "member", destructive: false },
  "Put a CAD comment into one of its robot's Design Reviews (design_review_id from list_design_reviews), or take it out (null). Its author or an admin may.",
  z.object({ comment_id: uuid, design_review_id: uuid.nullable() }),
  async ({ comment_id, design_review_id }, { member }) => {
    const [c] = await db.select({ body: reviewComments.body, authorId: reviewComments.authorId }).from(reviewComments).where(eq(reviewComments.id, comment_id));
    if (!c) throw new ToolError("Unknown comment.");
    if (!member.isAdmin && c.authorId !== member.id) throw new ToolError("Only its author or an admin moves a comment into a Design Review.");
    return {
      count: 1,
      summary: design_review_id ? "Added a comment to a Design Review" : "Took a comment out of its Design Review",
      preview: { comment: c.body, design_review_id },
      apply: () => asTool(async () => ({ id: (await setCommentReview(member, comment_id, design_review_id)).robotId })),
    };
  },
);
