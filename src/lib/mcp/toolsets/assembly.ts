import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { StepError, tickStep } from "@/lib/assembly/steps";
import { makeBook, stepKeys, stepRefsOf } from "@/lib/assembly/view";
import { loadAssembly } from "@/lib/data/assembly";
import { read, uuid, write, ToolError } from "../registry";

const { assemblySteps, systems } = schema;

// The Assembly page (plan/assembly-guides.md): its steps and how far the build is, as text, and
// ticking steps off. Writing steps stays on the page (it needs the 3D).

read(
  "list_assembly_steps",
  "member",
  "A robot's assembly steps (the Assembly page): per system, its steps in order, then each sub-assembly's (sub-assemblies come from the part number: 1690-26-421-01 is sub-assembly 42 of system 400). Each step: title, text, critical, done (who, when), its parts, and the earlier steps (by number) it brings in whole. A step of kind sub_assembly stands for a whole sub-assembly; it's done when all that sub-assembly's steps are. robot_id from list_robots; system_id narrows it to one system.",
  z.object({ robot_id: uuid, system_id: uuid.optional() }),
  async ({ robot_id, system_id }) => {
    const data = await loadAssembly(robot_id);
    const book = makeBook(data);
    const partByKey = new Map(data.parts.map((p) => [p.key, p]));
    const steps = (systemId: string, sub: string | null) => {
      const list = book.steps({ systemId, sub });
      return list.map((s, i) => ({
        id: s.id,
        n: i + 1,
        kind: s.kind === "sub" ? "sub_assembly" : "step",
        title: s.kind === "sub" && s.subRef ? s.title || book.subName(systemId, s.subRef) : s.title,
        text: s.body || null,
        critical: s.critical,
        done: book.done(s),
        ticked: s.tick,
        sub_assembly: s.kind === "sub" ? s.subRef : undefined,
        brings_in_steps: s.stepRefs.length ? stepRefsOf(book, list, s).map((r) => r.n) : undefined,
        parts: s.kind === "sub" ? undefined : stepKeys(book, s).flatMap((k) => partByKey.get(k) ?? []).map((p) => ({ name: p.name, part_number: p.number, quantity: p.qty, cots: p.cots })),
      }));
    };
    const out = book.systems
      .filter((s) => !system_id || s.id === system_id)
      .map((s) => ({
        system_id: s.id,
        system: s.name,
        progress: book.progress({ systemId: s.id, sub: null }),
        steps: steps(s.id, null),
        sub_assemblies: s.subs.map((x) => ({ code: x.code, name: x.name, progress: book.progress({ systemId: s.id, sub: x.code }), steps: steps(s.id, x.code) })),
      }));
    if (system_id && !out.length) throw new ToolError("That system isn't on this robot.");
    return out;
  },
);

write(
  "tick_assembly_steps",
  { cap: "work", destructive: true },
  "Mark assembly steps done (or not done, with done: false), as ticking them on the Assembly page. Step ids from list_assembly_steps. Any member with a team may. A sub_assembly step with steps of its own is done by ticking those.",
  z.object({ step_ids: z.array(uuid).min(1).max(100), done: z.boolean().optional() }),
  async ({ step_ids, done = true }, { member }) => {
    const rows = await db
      .select({ id: assemblySteps.id, title: assemblySteps.title, robotId: systems.robotId, system: systems.name })
      .from(assemblySteps)
      .innerJoin(systems, eq(systems.id, assemblySteps.systemId))
      .where(and(inArray(assemblySteps.id, step_ids)));
    return {
      count: rows.length,
      summary: `Marked ${rows.length} assembly ${rows.length === 1 ? "step" : "steps"} ${done ? "done" : "not done"}`,
      preview: rows.map((r) => ({ id: r.id, system: r.system, step: r.title })),
      apply: async () => {
        try {
          for (const r of rows) await tickStep(r.robotId, member.id, r.id, done);
        } catch (err) {
          if (err instanceof StepError) throw new ToolError(err.message);
          throw err;
        }
        return { ticked: rows.length, done };
      },
    };
  },
);
