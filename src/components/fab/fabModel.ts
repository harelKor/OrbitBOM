import type { Priority } from "@/config/priorities";
import { STATUSES, type StatusName } from "@/config/statuses";
import { type CardPart } from "@/components/bom/types";
import { FINISHED_STATUS, IN_PROCESS_STATUS, READY_STATUS, fabStage, isFabFinished, machinesOf } from "@/lib/fab";
import { type PartChanges } from "@/lib/parts/changes";
import { computeStatus, isDone } from "@/lib/status";
import { statusTint, tint } from "@/components/ui/statusTint";

// To Fab's rules, without React: batches, stages, colours and what a part takes from its batch.

// Cards (the default) or List: horizontal rows, batches folding open below their row.
export type FabLayout = "cards" | "list";

export type Batch = {
  id: string;
  name: string;
  machine: string | null;
  madeBy: string | null;
  priority: Priority;
  gcode: { id: string; filename: string } | null;
  createdAt: string; // ISO; a closed batch shows its date
  onshapeLayoutUrl?: string | null; // the batch's "Batch - <name>" assembly in Onshape, once made
};

// A batch's priority colours all its text. "normal" (the default) is no priority; the shop's three
// levels use the stored critical / high / low.
export const BATCH_PRIORITIES = [
  { value: "critical", label: "High", color: "#dc2626" },
  { value: "high", label: "Mid", color: "#ea580c" },
  { value: "low", label: "Low", color: "#ca8a04" },
] as const satisfies readonly { value: Priority; label: string; color: string }[];
export const priorityColor = (p: Priority) => BATCH_PRIORITIES.find((x) => x.value === p)?.color;

// A batch with mixed statuses takes the colour of its least advanced part (finished parts last).
export const STATUS_RANK = new Map<string, number>(STATUSES.map((s, i) => [s.name, i]));
export const rank = (p: CardPart) => (isFabFinished(p) ? Infinity : (STATUS_RANK.get(computeStatus(p)) ?? 0));

// Dragging cards or batches between sections sets their status. Released holds loose parts only;
// Ready to Fab holds batches only (their parts are still Released: it is a To Fab section, not a status).
export const DRAG_TYPE = "application/x-orbit-parts";
export const SECTION_STATUS = { ready: READY_STATUS, readyToFab: READY_STATUS, inProcess: IN_PROCESS_STATUS, finished: FINISHED_STATUS } as const;
export type Stage = keyof typeof SECTION_STATUS;
// What a drag carries: the parts, the section they come from (dropping back there does nothing),
// the batch they come from and whether it is the whole batch.
export type DragLoad = { ids: string[]; from: Stage | null; batch: string | null; whole: boolean };
export const partStage = (p: CardPart): Stage | null => (isFabFinished(p) ? "finished" : fabStage(p));

// A batch sits in Ready to Fab while any part still waits to start, then in In process, and in
// Finished once every part is done.
export const batchStage = (members: CardPart[]): Stage =>
  members.every(isDone)
    ? "finished"
    : members.some((p) => fabStage(p) === "ready") || !members.some((p) => fabStage(p) === "inProcess")
      ? "readyToFab"
      : "inProcess";

export const POST_PROCESSING: StatusName = "Post Processing";
export const isPostProcessing = (p: CardPart) => computeStatus(p) === POST_PROCESSING;

// Cards take their status's colour; a batch takes it when all its parts share one status. On To
// Fab, finished parts and batches are painted green whatever their status.
export const FINISHED_COLOR = "#16a34a";
// On To Fab, Released parts are plain: leads hand them out as batches, and Ready to Fab takes the colour.
export const fabTint = (p: CardPart) => (isFabFinished(p) ? tint(FINISHED_COLOR) : computeStatus(p) === READY_STATUS ? {} : statusTint(computeStatus(p)));

export const common = (lists: string[][]) => (lists.length ? lists.reduce((acc, l) => acc.filter((m) => l.includes(m))) : []);

// The material filter boxes go by the exact material ("3mm 6061-T6"); NO_MATERIAL stands for none.
export const NO_MATERIAL_KEY = "none";
export const materialKeyOf = (p: CardPart) => p.material || NO_MATERIAL_KEY;

// A batch part with no machine or no material can take them from the rest of the batch: the
// material of a part that has one, and the machines of a part that has them (else the batch's).
export function inheritFromBatch(p: CardPart, batch: Batch, members: CardPart[]): PartChanges | null {
  const others = members.filter((m) => m.id !== p.id);
  const changes: PartChanges = {};
  const material = others.find((m) => m.material)?.material;
  if (!p.material && material) changes.material = material;
  if (!machinesOf(p).length) {
    const donor = others.find((m) => machinesOf(m).length > 0);
    if (donor) Object.assign(changes, { preProcess: donor.preProcess, process1: donor.process1, process2: donor.process2 });
    else if (batch.machine) changes.process1 = batch.machine;
  }
  return Object.keys(changes).length ? changes : null;
}

// A released part on To Fab shows the state it was released at (plan/fab-version-lock.md): its
// amount and picture then, and a red Changed tag when the BOM has moved past it since.
export function fabState(p: CardPart): CardPart {
  const lock = p.fabLock;
  if (!lock) return p;
  return { ...p, quantity: lock.quantity, thumbUrl: lock.thumbUrl ?? p.thumbUrl, fabView: { changed: lock.changed } };
}

// The status a part dragged onto a batch takes: the batch's least advanced unfinished status
// (none once every part is done).
export function batchStatus(members: CardPart[]): StatusName | null {
  const open = members.filter((p) => !isDone(p));
  if (!open.length) return null;
  return computeStatus(open.reduce((a, p) => (rank(p) < rank(a) ? p : a), open[0])) as StatusName;
}
