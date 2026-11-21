import { getMachine, isFactoryFabMachine } from "@/config/machines";
import { parseFastener } from "@/lib/inventory/fastener";

// The system page's group cards (Harel, 2026-11-21): every part lands in one group, worked out
// from its type, process and material, so a system's bearings, screws, prints, tubes and each
// sheet are a tap away. Pure: the page passes the inventory items the parts link to.

export type GroupPart = {
  id: string;
  classification: "inhouse" | "cots" | "external" | "undefined";
  material: string | null;
  quantity: number;
  process1: string | null;
  addedProcesses: { machine: string }[];
  displayName: string | null;
  onshapeName: string | null;
  inventoryItemId: string | null;
  shelf?: { itemId: string; itemName: string } | null;
};
// An inventory item as the material picker lists it: its category and specs.
export type GroupItem = { id: string; name: string; category: string; raw: boolean; specs: Record<string, string> };

export type BomGroup<P extends GroupPart = GroupPart> = {
  key: string;
  name: string;
  parts: P[];
  pieces: number;
  children?: BomGroup<P>[]; // tapping the card shows these (sheets by thickness, screws by size)
};

// Process 1 and the added processes (processMachines in lib/status.ts, without its full part type).
const processMachines = (p: Pick<GroupPart, "process1" | "addedProcesses">) => [p.process1, ...p.addedProcesses.map((a) => a.machine)].filter((m): m is string => !!m);

// The BOM's type dropdown (Harel, 2026-11-21): In Factory = a process at a Factory Fab factory.
export type PartType = "all" | "cots" | "inhouse" | "factory";
export function matchesType(p: Pick<GroupPart, "classification" | "process1" | "addedProcesses">, type: PartType): boolean {
  if (type === "cots") return p.classification === "cots";
  if (type === "inhouse") return p.classification === "inhouse";
  if (type === "factory") return processMachines(p).some(isFactoryFabMachine);
  return true;
}

// More sheet groups than this nest under one card per material; a Screws group bigger than
// SCREW_SPLIT opens into one card per thread (Harel, 2026-11-21).
const SHEET_NEST = 3;
const SCREW_SPLIT = 8;

const NOT_SET_UP = "Not set up";
const RAW_GROUPS: Record<string, string> = { shafts: "Shafts", "round-tubes": "Tubes", "square-tubes": "Box tubes" };
const COTS_GROUPS: Record<string, string> = { bearings: "Bearings", gears: "Gears", belts: "Belts" };
const SHEET_MATERIAL: Record<string, string> = { "aluminum-plates": "Aluminum", polycarbonate: "Polycarbonate", "wood-composites": "Wood" };
// Names that say what a bought part is when it isn't linked to an item.
const COTS_WORDS: [string, RegExp][] = [
  ["Bearings", /bearing|מיסב/i],
  ["Gears", /\bgears?\b|גלגל\s*שיניים/i],
  ["Belts", /\bbelts?\b|רצוע/i],
];
const RIVET = /rivet|ניט/i;

// The card order: bought first, then made, then what still needs setting up.
const ORDER = ["Bearings", "Gears", "Belts", "Screws", "COTS", "3D prints", "Shafts", "Tubes", "Box tubes"];
const rank = (name: string) => {
  if (name === NOT_SET_UP) return 1000;
  const i = ORDER.indexOf(name);
  return i < 0 ? 500 : i; // sheets and other stock between the tubes and Not set up
};

type Place = { top: string; name: string; sheet?: { material: string; thickness: string | null }; thread?: string };

const mm = (v: string) => `${String(Number(v))} mm`;
function thicknessOf(item: GroupItem): string | null {
  if (item.specs.thickness && Number(item.specs.thickness)) return mm(item.specs.thickness);
  const m = /(\d+(?:\.\d+)?)\s*mm/i.exec(item.name);
  return m ? mm(m[1]) : null;
}
// A sheet's material word: Aluminum for 6061-T6 too, a wood sheet's own kind, else the category's.
function sheetMaterial(item: GroupItem): string {
  if (item.category === "wood-composites" && item.specs.material) return item.specs.material.split("/")[0];
  return SHEET_MATERIAL[item.category] ?? item.category.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function placeOf(p: GroupPart, itemById: Map<string, GroupItem>, itemByName: Map<string, GroupItem>): Place {
  const item = itemById.get(p.inventoryItemId ?? p.shelf?.itemId ?? "") ?? (p.material ? itemByName.get(p.material) : undefined);
  if (p.classification === "cots") {
    const names = [p.displayName, p.onshapeName, p.shelf?.itemName, item?.name];
    const cat = item?.category;
    if (cat && COTS_GROUPS[cat]) return { top: COTS_GROUPS[cat], name: COTS_GROUPS[cat] };
    if (cat === "fasteners" || cat === "rivets" || names.some((n) => n && RIVET.test(n))) {
      const thread = names.map(parseFastener).find((f) => f?.thread)?.thread ?? (names.some((n) => n && RIVET.test(n)) ? "Rivets" : "Other");
      return { top: "Screws", name: "Screws", thread };
    }
    const f = names.map(parseFastener).find((x) => !!x);
    if (f) return { top: "Screws", name: "Screws", thread: f.thread ?? "Other" };
    const word = COTS_WORDS.find(([, re]) => names.some((n) => n && re.test(n)));
    if (word) return { top: word[0], name: word[0] };
    return { top: "COTS", name: "COTS" };
  }
  if (p.classification === "undefined") return { top: NOT_SET_UP, name: NOT_SET_UP };
  if (processMachines(p).some((m) => getMachine(m)?.kind === "print")) return { top: "3D prints", name: "3D prints" };
  if (!item) return { top: NOT_SET_UP, name: NOT_SET_UP };
  if (RAW_GROUPS[item.category]) return { top: RAW_GROUPS[item.category], name: RAW_GROUPS[item.category] };
  if (SHEET_MATERIAL[item.category] || (item.raw && thicknessOf(item))) {
    const material = sheetMaterial(item);
    const thickness = thicknessOf(item);
    return { top: `sheet:${material}:${thickness ?? item.name}`, name: thickness ? `${thickness} ${material}` : item.name, sheet: { material, thickness } };
  }
  // Other stock (blocks, cylinders, filament) by its item.
  return { top: `item:${item.name}`, name: item.name };
}

const threadRank = (t: string) => (t === "Other" ? 2 : t === "Rivets" ? 1 : 0);

function group<P extends GroupPart>(key: string, name: string, parts: P[], children?: BomGroup<P>[]): BomGroup<P> {
  return { key, name, parts, pieces: parts.reduce((n, p) => n + Math.max(p.quantity, 0), 0), ...(children ? { children } : {}) };
}

export function groupParts<P extends GroupPart>(parts: P[], items: GroupItem[]): BomGroup<P>[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByName = new Map<string, GroupItem>();
  for (const i of items) if (!itemByName.has(i.name)) itemByName.set(i.name, i);

  const places = new Map(parts.map((p) => [p.id, placeOf(p, itemById, itemByName)]));
  const tops = new Map<string, { place: Place; parts: P[] }>();
  for (const p of parts) {
    const place = places.get(p.id)!;
    const at = tops.get(place.top);
    if (at) at.parts.push(p);
    else tops.set(place.top, { place, parts: [p] });
  }

  const out: BomGroup<P>[] = [];
  const sheets = [...tops.values()].filter((t) => t.place.sheet);
  const nestSheets = sheets.length > SHEET_NEST;
  const sheetByMaterial = new Map<string, typeof sheets>();
  for (const [key, { place, parts: list }] of tops) {
    if (place.sheet && nestSheets) {
      const m = place.sheet.material;
      sheetByMaterial.set(m, [...(sheetByMaterial.get(m) ?? []), { place, parts: list }]);
      continue;
    }
    if (key === "Screws" && list.length > SCREW_SPLIT) {
      const byThread = new Map<string, P[]>();
      for (const p of list) {
        const t = places.get(p.id)!.thread ?? "Other";
        byThread.set(t, [...(byThread.get(t) ?? []), p]);
      }
      const children = [...byThread]
        .sort(([a], [b]) => threadRank(a) - threadRank(b) || a.localeCompare(b, undefined, { numeric: true }))
        .map(([t, l]) => group(`screws:${t}`, t, l));
      out.push(group(key, place.name, list, children.length > 1 ? children : undefined));
      continue;
    }
    out.push(group(key, place.name, list));
  }
  for (const [material, list] of sheetByMaterial) {
    const children = list
      .sort((a, b) => parseFloat(a.place.sheet!.thickness ?? "999") - parseFloat(b.place.sheet!.thickness ?? "999"))
      // Under its material's ‹ back, a thickness card needs only the thickness.
      .map((t) => group(t.place.top, t.place.sheet!.thickness ?? t.place.name, t.parts));
    out.push(group(`sheets:${material}`, material, list.flatMap((t) => t.parts), children.length > 1 ? children : undefined));
  }
  // Sheets by material, then thinnest first.
  const sheetOf = (g: BomGroup<P>) => tops.get(g.key)?.place.sheet;
  const thick = (g: BomGroup<P>) => parseFloat(sheetOf(g)?.thickness ?? "999");
  return out.sort((a, b) => {
    const sa = sheetOf(a);
    const sb = sheetOf(b);
    return rank(a.name) - rank(b.name) || (sa && sb ? sa.material.localeCompare(sb.material) || thick(a) - thick(b) : 0) || a.name.localeCompare(b.name);
  });
}

// A group anywhere in the tree by its key.
export function findGroup<P extends GroupPart>(groups: BomGroup<P>[], key: string): BomGroup<P> | undefined {
  for (const g of groups) {
    if (g.key === key) return g;
    const inner = g.children && findGroup(g.children, key);
    if (inner) return inner;
  }
  return undefined;
}

// Whether the section is worth showing: some part is set up.
export const anySetUp = (groups: BomGroup[]) => groups.some((g) => g.name !== NOT_SET_UP);
