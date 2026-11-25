// The one place part edits are validated and turned into column updates. The card, Bulk edit,
// sync and the MCP server all go through it, so they share the same rules (plan §3, §6):
// - choosing a status stores it and resets the counters; moving a counter clears the status;
// - editing a field that comes from Onshape marks it overridden, so later syncs keep the edit;
// - giving a COTS or Undefined part a machine in the app makes it In-house (In factory when the machine is a factory's);
// - a bought part marked In Stock from the Order List waits for CAD's QA (Harel, 2026-11-20).

import { z } from "zod";
import { COTS_PROCESS, MACHINES } from "@/config/machines";
import { PRIORITIES } from "@/config/priorities";
import { COTS_IN_STOCK, ORDER_STATUSES, isCotsStatusName } from "@/config/cots";
import { DONE_STATUSES, isPickableStatus, processStatusOf } from "@/config/statuses";
import { applyStatus, computeStatus, hasProgress, isCotsProcess, isMidQa, isUnreleased, orderStatus, processesOf, stageOf, statusAtProcess, type AddedProcess } from "@/lib/status";

const machineIds = MACHINES.map((m) => m.id) as [string, ...string[]];
const ORDERING: string[] = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK);

const text = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => v || null)
  .nullable();
const count = z.coerce.number().int().min(0).max(100000);
const minutes = z.coerce.number().int().min(0).max(100000).nullable();
const delta = z.number().int().min(-1000).max(1000);

export const MAX_ADDED_PROCESSES = 20;

export const partChangesSchema = z
  .object({
    displayName: text,
    partNumber: text,
    classification: z.enum(["inhouse", "cots", "external", "undefined"]),
    description: text,
    material: text,
    quantity: count,
    // Process 1: a machine, or COTS (bought, then QA, then the added processes).
    process1: z.enum([...machineIds, COTS_PROCESS] as [string, ...string[]]).nullable(),
    // The first added process's machine, as Onshape's Process 2 property sets it on Update BOM
    // (null takes that process away). Later added processes and the QA ticks stay.
    process2: z.enum(machineIds).nullable(),
    // The processes after Process 1, in order. Each keeps its count while its machine stays.
    // `from`: the saved entry it continues (its index), so taking one out doesn't hand the next
    // one's count to another (BOM-6); without it, entries match by position.
    addedProcesses: z.array(z.object({ machine: z.enum(machineIds), qa: z.boolean(), from: z.number().int().min(0).max(MAX_ADDED_PROCESSES - 1).optional() })).max(MAX_ADDED_PROCESSES),
    // Bulk edit's "+ Add process": one more process after the part's last one.
    appendProcess: z.object({ machine: z.enum(machineIds), qa: z.boolean() }),
    status: z.string().refine((s) => isPickableStatus(s) || isCotsStatusName(s), "Unknown status"),
    doneProcess1: count,
    // Done counts of the added processes, by position (0 = Process 2).
    addedDone: z.array(count).max(MAX_ADDED_PROCESSES),
    postDone: count,
    priority: z.enum(PRIORITIES),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    designerName: text,
    // Who made the part at each process: process1, process2, process3...
    fabricators: z.record(z.string().regex(/^process\d{1,2}$/), z.string().trim().max(200)),
    note: text,
    estMinutes: minutes,
    actualMinutes: minutes,
    drawingUrl: z.url().nullable(),
    inventoryItemId: z.uuid().nullable(),
    cotsLinks: z
      .array(
        z.object({
          url: z.url({ protocol: /^https?$/ }),
          site: z.string().trim().max(100).optional(),
          priceUsd: z.number().min(0).max(1_000_000).optional(),
        }),
      )
      .max(20),
    unitPrice: z.number().min(0).max(1_000_000).nullable(),
    cotsCategory: z.string().trim().min(1).max(60).nullable(), // an inventory category id
    stockCount: count,
    cotsSentBack: text,
    cotsDeliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    // The name on the Released and Order List pages; null shows the item's (or the part's) name.
    orderName: text,
    // Merged into one order line with the other parts that share it (mergeOrderRows checks them).
    orderMerge: z.uuid().nullable(),
    // The amount to order, typed on the order pages; null goes back to the worked-out amount.
    orderQty: count.nullable(),
    // Counts one more (or takes one back) from the saved count rather than the page's copy, so
    // two people counting the same part at once never lose a piece (resolveCounterAdds).
    add: z.partialRecord(z.enum(["doneProcess1", "postDone", "stockCount"]), delta),
    // The same for an added process: its number (2 = the first added one).
    addAt: z.object({ process: z.number().int().min(2).max(MAX_ADDED_PROCESSES + 1), delta }),
    // "Move to QA?" answered No on a "+" that finished a step leading to QA: the part stays at its
    // process (true); the card's Move to QA sends false (Harel, 2026-11-20).
    qaHeld: z.boolean(),
    // CAD approves the QA the part waits for: a mid-way one releases it to its next process, the
    // final one (and a bought part's) puts it In Stock.
    // "reopen" takes the approval back (the QA box's undo).
    qa: z.enum(["approve", "reopen"]),
    // Marked In Stock from the "In Stock?" tag: the shelf already had these units, so nothing
    // arrived (no Order History row, no stock added, no QA). Not a part field.
    fromShelfPrompt: z.literal(true),
    // Set In Stock by the card's stock count: the shelf had them, so no QA. Not a part field.
    fromStock: z.literal(true),
    // The status is for the process the part is at (To Fab's batch menu, drops and Fab): Released
    // and In Process 1 become Released P{n} / In Process {n} past Process 1 (statusAtProcess).
    // Not a part field.
    atProcess: z.literal(true),
    // Release's bar: only a part not released yet takes the status; the rest stay as they are
    // (audit 2026-11-25, BOM-4). Not a part field.
    ifUnreleased: z.literal(true),
  })
  .partial();

export type PartChanges = z.infer<typeof partChangesSchema>;

// Fields Onshape fills in on sync; FRCBOM's overridden_fields names (ref §6) map to these.
export const ONSHAPE_FIELDS = [
  "description",
  "material",
  "quantity",
  "process1",
  // The first added process's machine (Onshape's Process 2 property).
  "process2",
] as const;

// The part columns a plan reads.
export type PartRow = {
  displayName: string | null;
  partNumber: string | null;
  classification: "inhouse" | "cots" | "external" | "undefined";
  description: string | null;
  material: string | null;
  quantity: number;
  process1: string | null;
  addedProcesses: AddedProcess[];
  designState: string | null;
  doneProcess1: number;
  postDone: number;
  qaHeld: boolean;
  cotsQa: boolean;
  priority: (typeof PRIORITIES)[number];
  deadline: string | null;
  designerName: string | null;
  fabricators: Record<string, string>;
  note: string | null;
  estMinutes: number | null;
  actualMinutes: number | null;
  drawingUrl: string | null;
  inventoryItemId: string | null;
  cotsLinks: { url: string; site?: string; priceUsd?: number }[];
  unitPrice: number | null;
  cotsCategory: string | null;
  stockCount: number;
  cotsSentBack: string | null;
  cotsDeliveryDate: string | null;
  orderName: string | null;
  orderMerge: string | null;
  orderQty: number | null;
  overriddenFields: string[];
};

export type HistoryEntry = { field: string; oldValue: unknown; newValue: unknown };
export type Plan = { set: Partial<PartRow>; history: HistoryEntry[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Turns `add` / `addAt` into counts from the part as it is saved now, between 0 and the quantity
// (a stock count has no top). Counts the same change also sets keep their value.
export function resolveCounterAdds(part: PartRow, changes: PartChanges): PartChanges {
  const { add, addAt, ...rest } = changes;
  if (!add && !addAt) return changes;
  const out: PartChanges = { ...rest };
  const full = Math.max(part.quantity, 1);
  for (const [field, d] of Object.entries(add ?? {}) as [keyof NonNullable<PartChanges["add"]>, number][]) {
    if (out[field] !== undefined || !d) continue;
    const next = Math.max(part[field] + d, 0);
    // A COTS card's stock count may go past the quantity (extras on hand); done counts can't.
    out[field] = field === "stockCount" ? next : Math.min(next, full);
  }
  if (addAt?.delta && out.addedDone === undefined) {
    const i = addAt.process - 2;
    if (part.addedProcesses[i]) out.addedDone = part.addedProcesses.map((p, j) => (j === i ? Math.min(Math.max(p.done + addAt.delta, 0), full) : p.done));
  }
  return out;
}

// A part whose status was picked at a later process (Released P3, or the old Ready for Process 2
// with its counts at 0): counting there starts from that process, not over at Process 1.
function withPickedCounts(part: PartRow): PartRow {
  if (part.classification === "cots" || hasProgress(part) || !part.designState || stageOf(part).index === 0) return part;
  const counts = applyStatus(processStatusOf(part.designState) ? part.designState : "Released P2", part);
  return { ...part, ...counts };
}

export function planPartUpdate(
  saved: PartRow,
  input: PartChanges,
  via: "ui" | "sync" | "mcp",
): Plan {
  const counting = input.add?.doneProcess1 !== undefined || input.addAt !== undefined || input.doneProcess1 !== undefined || input.addedDone !== undefined;
  // What the counts start from; history and the set compare with the saved row.
  const base = counting ? withPickedCounts(saved) : saved;
  const changes = resolveCounterAdds(base, input);
  const { status, doneProcess1, addedDone, addedProcesses, appendProcess, process2, fabricators, qa, qaHeld, ...rest } = changes;
  delete rest.fromShelfPrompt; // a flag for applyEachPartChanges, not a part field
  delete rest.fromStock;
  delete rest.atProcess;
  delete rest.ifUnreleased;
  const next: Partial<PartRow> = { ...rest };
  if (base !== saved) Object.assign(next, { doneProcess1: base.doneProcess1, addedProcesses: base.addedProcesses, designState: base.designState });
  const part = { ...base, ...next } as PartRow;
  const needed = Math.max(part.quantity, 1);
  const after = () => ({ ...part, ...next }) as PartRow;

  // The list of added processes: an entry keeps its count and QA while its machine stays.
  if (addedProcesses) {
    next.addedProcesses = addedProcesses.map((p, i) => {
      const was = part.addedProcesses[p.from ?? i];
      return was && was.machine === p.machine ? { ...was, qa: p.qa } : { machine: p.machine, qa: p.qa, done: 0, qaDone: false };
    });
  }

  if (appendProcess && !addedProcesses && part.addedProcesses.length < MAX_ADDED_PROCESSES) next.addedProcesses = [...part.addedProcesses, { ...appendProcess, done: 0, qaDone: false }];
  if (process2 !== undefined && !addedProcesses) {
    const list = part.addedProcesses;
    if (process2 === null) next.addedProcesses = list.slice(1);
    else if (!list.length) next.addedProcesses = [{ machine: process2, done: 0, qa: false, qaDone: false }];
    else if (list[0].machine !== process2) next.addedProcesses = [{ ...list[0], machine: process2, done: 0 }, ...list.slice(1)];
  }

  if (status !== undefined && !(input.ifUnreleased && !isUnreleased(saved))) {
    const picked = input.atProcess ? statusAtProcess(after(), status) : status;
    const numbered = processStatusOf(picked);
    // A numbered status the part has no process for (Released P3 with one added process) is skipped.
    if (!numbered || numbered.n - 1 <= after().addedProcesses.length) {
      const now = after();
      // Arrived from the Order List: QA first. Taken from the shelf: no QA (Harel, 2026-11-20).
      const arrived = picked === COTS_IN_STOCK && !input.fromShelfPrompt && !input.fromStock && ORDERING.includes(orderStatus(now));
      if (arrived && now.classification !== "cots" && now.classification !== "external" && isCotsProcess(now)) {
        // Bought as its Process 1: In Stock on the Order List, Ready for QA in the BOM.
        Object.assign(next, { designState: null, doneProcess1: needed, addedProcesses: now.addedProcesses.map((p) => ({ ...p, done: 0, qaDone: false })), qaHeld: false, cotsQa: false });
      } else {
        Object.assign(next, applyStatus(picked, now), { cotsQa: arrived && now.classification === "cots" });
      }
      // The post-processed count belongs to Post Processing and the done statuses after it.
      if (rest.postDone === undefined && picked !== "Post Processing" && !(DONE_STATUSES as string[]).includes(picked)) next.postDone = 0;
    }
  }
  if (doneProcess1 !== undefined || addedDone !== undefined) {
    const now = after();
    if (doneProcess1 !== undefined) next.doneProcess1 = doneProcess1;
    // Nothing is counted at a process still waiting for CAD's QA (audit 2026-11-25, BOM-1). A part
    // set to a done status from a menu (no counts yet) still takes its "−" as before.
    const procs = processesOf(now);
    const shut = (i: number, n: number) => via !== "sync" && hasProgress(base) && procs[i + 1]?.qa && !procs[i + 1].qaDone && n > now.addedProcesses[i].done;
    if (addedDone !== undefined) next.addedProcesses = now.addedProcesses.map((p, i) => (addedDone[i] === undefined || shut(i, addedDone[i]) ? p : { ...p, done: addedDone[i] }));
    // Moving a counter clears the stored design state, as FRCBOM does.
    const counts = [next.doneProcess1 ?? now.doneProcess1, ...(next.addedProcesses ?? now.addedProcesses).map((p) => p.done)];
    if (counts.some((n) => n > 0)) next.designState = null;
  }
  if (qaHeld !== undefined) next.qaHeld = qaHeld;
  if (qa === "approve") {
    const now = after();
    if (now.classification === "cots") {
      if (now.cotsQa) next.cotsQa = false;
    } else if (isMidQa(now)) {
      const i = stageOf(now).index - 1;
      next.addedProcesses = now.addedProcesses.map((p, j) => (j === i ? { ...p, qaDone: true } : p));
      next.qaHeld = false;
    } else if (computeStatus(now) === "Ready for QA") Object.assign(next, applyStatus(COTS_IN_STOCK, now));
  } else if (qa === "reopen") {
    const now = after();
    const stage = stageOf(now);
    const released = now.addedProcesses[stage.index - 1];
    if (now.classification === "cots") {
      if (computeStatus(now) === COTS_IN_STOCK) next.cotsQa = true;
    } else if (stage.status === "Released P2+" && hasProgress(now) && released?.qaDone && (released.qa || (stage.index === 1 && isCotsProcess(now)))) {
      next.addedProcesses = now.addedProcesses.map((p, j) => (j === stage.index - 1 ? { ...p, qaDone: false } : p));
      next.designState = null;
    } else if (computeStatus(now) === COTS_IN_STOCK) Object.assign(next, applyStatus("Ready for QA", now));
  }
  if (fabricators) next.fabricators = { ...part.fabricators, ...fabricators };
  const setsMachine = !!rest.process1 || !!process2 || !!addedProcesses?.length || !!appendProcess;
  if (via !== "sync" && setsMachine && rest.classification === undefined && (saved.classification === "cots" || saved.classification === "undefined")) next.classification = "inhouse";

  const set: Partial<PartRow> = {};
  const history: HistoryEntry[] = [];
  for (const [field, value] of Object.entries(next) as [keyof PartRow, unknown][]) {
    if (same(saved[field], value)) continue;
    (set as Record<string, unknown>)[field] = value;
    history.push({ field, oldValue: saved[field] ?? null, newValue: value ?? null });
  }

  if (via !== "sync") {
    const firstMachine = (l: AddedProcess[] | undefined) => l?.[0]?.machine ?? null;
    const changed = (f: (typeof ONSHAPE_FIELDS)[number]) => (f === "process2" ? "addedProcesses" in set && firstMachine(set.addedProcesses) !== firstMachine(saved.addedProcesses) : f in set);
    const overridden = ONSHAPE_FIELDS.filter((f) => changed(f) && !saved.overriddenFields.includes(f));
    if (overridden.length) {
      // Recorded like any field, so undoing the edit hands the field back to Onshape's sync.
      set.overriddenFields = [...saved.overriddenFields, ...overridden];
      history.push({ field: "overriddenFields", oldValue: saved.overriddenFields, newValue: set.overriddenFields });
    }
  }
  return { set, history };
}
