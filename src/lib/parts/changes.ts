// The one place part edits are validated and turned into column updates. The card, Bulk edit,
// sync and the MCP server all go through it, so they share the same rules (plan §3, §6):
// - choosing a status stores it and resets the counters; moving a counter clears the status;
// - editing a field that comes from Onshape marks it overridden, so later syncs keep the edit;
// - giving a COTS or Undefined part a machine in the app makes it In-house (In factory when the machine is a factory's).

import { z } from "zod";
import { MACHINES } from "@/config/machines";
import { PRIORITIES } from "@/config/priorities";
import { COTS_STATUSES } from "@/config/cots";
import { DONE_STATUSES, STATUSES } from "@/config/statuses";
import { applyCounters, applyStatus } from "@/lib/status";

const machineIds = MACHINES.map((m) => m.id) as [string, ...string[]];
const statusNames = [...new Set([...STATUSES, ...COTS_STATUSES].map((s) => s.name))] as [string, ...string[]];

const text = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => v || null)
  .nullable();
const machine = z.enum(machineIds).nullable();
const count = z.coerce.number().int().min(0).max(100000);
const minutes = z.coerce.number().int().min(0).max(100000).nullable();

export const partChangesSchema = z
  .object({
    displayName: text,
    partNumber: text,
    classification: z.enum(["inhouse", "cots", "external", "undefined"]),
    description: text,
    material: text,
    quantity: count,
    preProcess: machine,
    process1: machine,
    process2: machine,
    status: z.enum(statusNames),
    donePreprocess: count,
    doneProcess1: count,
    doneProcess2: count,
    postDone: count,
    priority: z.enum(PRIORITIES),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    designerName: text,
    fabricators: z.partialRecord(
      z.enum(["preProcess", "process1", "process2"]),
      z.string().trim().max(200),
    ),
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
  })
  .partial();

export type PartChanges = z.infer<typeof partChangesSchema>;

// Fields Onshape fills in on sync; FRCBOM's overridden_fields names (ref §6) map to these.
export const ONSHAPE_FIELDS = [
  "description",
  "material",
  "quantity",
  "preProcess",
  "process1",
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
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
  designState: string | null;
  donePreprocess: number;
  doneProcess1: number;
  doneProcess2: number;
  postDone: number;
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
  overriddenFields: string[];
};

export type HistoryEntry = { field: string; oldValue: unknown; newValue: unknown };
export type Plan = { set: Partial<PartRow>; history: HistoryEntry[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planPartUpdate(
  part: PartRow,
  changes: PartChanges,
  via: "ui" | "sync" | "mcp",
): Plan {
  const { status, donePreprocess, doneProcess1, doneProcess2, fabricators, ...rest } = changes;
  const next: Partial<PartRow> = { ...rest };

  if (status !== undefined) Object.assign(next, applyStatus(status));
  // The post-processed count belongs to Post Processing and the done statuses after it.
  if (status !== undefined && rest.postDone === undefined && status !== "Post Processing" && !(DONE_STATUSES as string[]).includes(status)) next.postDone = 0;
  const counters = Object.fromEntries(
    Object.entries({ donePreprocess, doneProcess1, doneProcess2 }).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(counters).length) Object.assign(next, applyCounters(counters));
  if (fabricators) next.fabricators = { ...part.fabricators, ...fabricators };
  const setsMachine = [rest.preProcess, rest.process1, rest.process2].some((m) => m);
  if (via !== "sync" && setsMachine && rest.classification === undefined && (part.classification === "cots" || part.classification === "undefined")) next.classification = "inhouse";

  const set: Partial<PartRow> = {};
  const history: HistoryEntry[] = [];
  for (const [field, value] of Object.entries(next) as [keyof PartRow, unknown][]) {
    if (same(part[field], value)) continue;
    (set as Record<string, unknown>)[field] = value;
    history.push({ field, oldValue: part[field] ?? null, newValue: value ?? null });
  }

  if (via !== "sync") {
    const overridden = ONSHAPE_FIELDS.filter((f) => f in set && !part.overriddenFields.includes(f));
    if (overridden.length) set.overriddenFields = [...part.overriddenFields, ...overridden];
  }
  return { set, history };
}
