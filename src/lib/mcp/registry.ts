import "server-only";
import { z } from "zod";
import { can, effectiveMode, type Capability } from "@/components/shell/mode";
import { COTS_PROCESS, findMachineByName, getMachine } from "@/config/machines";
import { schema } from "@/db";
import type { Member } from "@/lib/auth";
import { partChangesSchema, type PartChanges } from "@/lib/parts/changes";
import { logAiAction } from "@/lib/review/review";
import { DENIED } from "@/lib/mode";
import { isDone, partStatusLabel } from "@/lib/status";
import { checkConfirmToken, confirmToken } from "./confirm";

// The MCP tools (plan §6). They run as the member who owns the token, with the same rules and
// history as the UI (via = "mcp"). Every write previews first and applies only with the
// confirm_token from its preview; changes to more than 50 parts also need confirm_large.

export const { parts, systems, robots, partFiles, partGroups, groupMembers, inventoryItems, inventoryMoves, inventoryLocations } = schema;

export const LARGE = 50;
export const uuid = z.guid(); // any UUID shape, like isUuid

export type Ctx = { member: Member; aiName?: string };
export type Planned = { preview: unknown; count: number; summary?: string; apply: () => Promise<unknown> };

// Who may call a tool: the capability its button in the app needs (mode.ts), or "member" for
// what any signed-in member may do there (reading, CAD Review comments). A function picks it from
// the arguments, like the part window does for each field; several must all be allowed.
export type ToolCap = Capability | "member";
type CapRule<A> = ToolCap | ToolCap[] | ((args: A) => ToolCap | ToolCap[]);

export type Tool = {
  name: string;
  description: string;
  input: z.ZodObject;
  write?: boolean;
  destructive?: boolean;
  cap: CapRule<never>;
  run: (args: never, ctx: Ctx) => Promise<unknown>;
};

export const tools: Tool[] = [];
export function read<S extends z.ZodObject>(name: string, cap: CapRule<z.infer<S>>, description: string, input: S, run: (args: z.infer<S>, ctx: Ctx) => Promise<unknown>) {
  tools.push({ name, description, input, cap: cap as Tool["cap"], run: run as Tool["run"] });
}

// `destructive`: the tool overwrites or removes what is there (MCP's destructiveHint), not only adds.
export function write<S extends z.ZodObject>(
  name: string,
  access: { cap: CapRule<z.infer<S>>; destructive: boolean },
  description: string,
  input: S,
  plan: (args: z.infer<S>, ctx: Ctx) => Promise<Planned>,
) {
  tools.push({
    name,
    description: `${description} Preview first: call without confirm_token to see exactly what would change, then call again with the same arguments and the confirm_token from the preview to apply it. More than ${LARGE} parts also needs confirm_large: true.`,
    input: input.extend({
      ai_name: z.string().trim().min(1).max(60).describe("Your own name, e.g. 'Claude Opus 5.5'. Shown to the team on To Review and AI logs instead of 'AI'."),
      confirm_token: z.string().optional().describe("From this tool's preview, to apply the change."),
      confirm_large: z.boolean().optional().describe(`Required with confirm_token when more than ${LARGE} parts change.`),
    }),
    write: true,
    destructive: access.destructive,
    cap: access.cap as Tool["cap"],
    run: (async (allArgs: z.infer<S> & { ai_name: string; confirm_token?: string; confirm_large?: boolean }, member: Ctx) => {
      // The AI's name labels the action but isn't part of what the member confirms.
      const { ai_name: aiName, ...args } = allArgs;
      const ctx: Ctx = { ...member, aiName };
      const planned = await plan(args as z.infer<S>, ctx);
      if (!args.confirm_token) {
        return {
          preview: planned.preview,
          count: planned.count,
          confirm_token: planned.count ? confirmToken(ctx.member.id, name, args) : null,
          next: planned.count
            ? `Show this to the member. To apply, call ${name} again with the same arguments and this confirm_token${planned.count > LARGE ? " and confirm_large: true" : ""}.`
            : "Nothing would change.",
        };
      }
      if (!checkConfirmToken(args.confirm_token, ctx.member.id, name, args)) {
        throw new ToolError("The confirm_token doesn't match these arguments or has expired. Preview again.");
      }
      if (planned.count > LARGE && !args.confirm_large) {
        throw new ToolError(`This changes ${planned.count} parts. Confirm with the member, then pass confirm_large: true.`);
      }
      const result = await planned.apply();
      // Every applied change shows on the AI logs page.
      const batchId = (result as { batch_id?: unknown } | null)?.batch_id;
      await logAiAction({
        source: "ai",
        tool: name,
        memberId: ctx.member.id,
        aiName,
        batchId: typeof batchId === "string" ? batchId : null,
        parts: planned.count,
        summary: planned.summary ?? `Applied to ${planned.count} ${planned.count === 1 ? "item" : "items"}`,
      }).catch((err) => console.error("AI log failed", err));
      return result;
    }) as Tool["run"],
  });
}

export class ToolError extends Error {}

// ---------- helpers ----------

export const nameOf = (p: { displayName: string | null; onshapeName: string | null; partNumber: string | null }) => {
  const name = p.displayName ?? p.onshapeName ?? "Unnamed part";
  return p.partNumber ? `${p.partNumber} ${name}` : name;
};
export const machineName = (id: string | null) => (id ? (id === COTS_PROCESS ? "COTS" : (getMachine(id)?.name ?? id)) : null);

// Machines may be given by name ("CNC") or id ("cnc").
export function machineId(value: string | null | undefined) {
  if (value == null || value === "") return value === "" ? null : value;
  const m = getMachine(value) ?? findMachineByName(value);
  if (!m) throw new ToolError(`Unknown machine "${value}". Use list_machines for the exact names.`);
  return m.id;
}

export function normaliseChanges(input: Record<string, unknown>): PartChanges {
  const c = { ...input };
  // Process 1 may be COTS: bought, then QA, then the added processes (Harel, 2026-11-20).
  if ("process1" in c) c.process1 = typeof c.process1 === "string" && c.process1.trim().toLowerCase() === COTS_PROCESS ? COTS_PROCESS : machineId(c.process1 as string | null);
  if ("process2" in c) c.process2 = machineId(c.process2 as string | null);
  if (Array.isArray(c.addedProcesses)) c.addedProcesses = (c.addedProcesses as { machine: string; qa?: boolean }[]).map((p) => ({ machine: machineId(p.machine), qa: !!p.qa }));
  if (c.appendProcess && typeof c.appendProcess === "object") {
    const a = c.appendProcess as { machine: string; qa?: boolean };
    c.appendProcess = { machine: machineId(a.machine), qa: !!a.qa };
  }
  const parsed = partChangesSchema.safeParse(c);
  if (!parsed.success) throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

export function summarise(p: typeof parts.$inferSelect & { systemName?: string }) {
  return {
    id: p.id,
    name: nameOf(p),
    system: p.systemName,
    type: p.classification,
    quantity: p.quantity,
    material: p.material,
    onshape_material: p.geometry?.onshapeMaterial ?? null,
    body_type: p.geometry?.bodyType ?? null,
    size_mm: p.geometry?.bbox ?? null,
    // Bent sheet uses the plate materials: sheet_metal is Onshape sheet metal (it has a flat
    // pattern), wall_mm the measured sheet thickness of a flat or bent thin wall.
    sheet_metal: !!p.geometry?.sheetMetal,
    wall_mm: p.geometry?.wallMm ?? null,
    // The stock shape read from the 3D model (hex, box-tube, round-tube, rod, spacer, plate, block).
    shape: p.geometry?.shape ?? null,
    process_1: machineName(p.process1),
    // The processes after Process 1, in order (Harel, 2026-11-20): QA needed before it starts.
    added_processes: p.addedProcesses.map((a, i) => ({ process: i + 2, machine: machineName(a.machine), done: a.done, qa_needed: a.qa })),
    status: partStatusLabel(p),
    // A Ready for QA before an added process isn't done; only the last one is.
    done: isDone(p),
    priority: p.priority,
    deadline: p.deadline,
    inventory_item_id: p.inventoryItemId,
  };
}

// History entries with machine names instead of ids, for previews.
export const readable = (c: { field: string; oldValue: unknown; newValue: unknown }) =>
  ["preProcess", "process1", "process2"].includes(c.field)
    ? { field: c.field, from: machineName(c.oldValue as string | null), to: machineName(c.newValue as string | null) }
    : c.field === "addedProcesses"
      ? { field: c.field, from: machineNames(c.oldValue), to: machineNames(c.newValue) }
      : { field: c.field, from: c.oldValue, to: c.newValue };
const machineNames = (v: unknown) => (Array.isArray(v) ? v.map((p: { machine?: string; qa?: boolean }) => `${machineName(p.machine ?? null)}${p.qa ? " (QA first)" : ""}`) : v);

// ---------- MCP plumbing ----------

export function listTools() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
    annotations: { readOnlyHint: !t.write, destructiveHint: !!t.destructive },
  }));
}

export async function callTool(name: string, args: unknown, ctx: Ctx) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`);
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  // The same role rules as the app's buttons: a member's token can't do more than they can there.
  const denied = capabilityDenied(tool, parsed.data, ctx.member);
  if (denied) throw new ToolError(denied);
  return tool.run(parsed.data as never, ctx);
}

// Why the member's mode can't call this tool with these arguments, or null. MCP has no mode
// cookie, so an admin counts as Edit and everyone else as their team ("none" without one).
export function capabilityDenied(tool: Pick<Tool, "cap">, args: unknown, member: Pick<Member, "isAdmin" | "team">): string | null {
  const rule = tool.cap as CapRule<unknown>;
  const caps = [typeof rule === "function" ? rule(args) : rule].flat();
  const mode = effectiveMode(member);
  for (const cap of caps) if (cap !== "member" && !can(mode, cap)) return DENIED[cap];
  return null;
}
