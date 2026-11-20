// Auto-link's guess of which inventory item a BOM part is (Harel, 2026-10-23: "based on any of
// the part's details that might relate them, even if the part isn't fully configured"). Each
// signal adds points; a size in the part's name that disagrees with the item rules the pair out.
// Every guess waits in To Review until someone approves it.

import { hashDistance } from "@/lib/images/dhash";
import type { InvCategory } from "./categories";
import { fastenerMatch, itemFastener, partFastener } from "./fastener";
import { normName, normUrl } from "./match";
import { parseSpecs, tokens } from "./quick";

export type LinkPart = {
  id: string;
  names: string[]; // its name and Onshape name
  onshapeKey: string | null; // did:eid:partId
  docKey: string | null; // did:eid, its Part Studio
  urls: string[];
  thumbHash: string | null;
};
export type LinkItem = {
  id: string;
  name: string;
  aliases: string[];
  category: InvCategory | undefined;
  specs: Record<string, string>;
  urls: string[];
  onshapeKey: string | null;
  // From the parts already linked to it.
  docKeys: string[];
  thumbHashes: { hash: string; partName: string }[];
};

export const LINK_THRESHOLD = 40;
const CERTAIN = 100;
// Words that say nothing about which product it is.
const FILLER = new Set(["part", "parts", "the", "a", "an", "and", "with", "for", "of", "copy", "new", "assy", "assembly", "default", "body"]);

const words = (s: string) => new Set(tokens(s).filter((w) => !FILLER.has(w) && !/^\d+$/.test(w)));

// How alike two names are, 0..1: half how much of the shorter name the other has, half overlap.
function nameLikeness(a: string, b: string) {
  if (normName(a) && normName(a) === normName(b)) return 1;
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  const both = [...A].filter((w) => B.has(w)).length;
  if (both < Math.min(2, A.size, B.size)) return 0;
  return 0.5 * (both / Math.min(A.size, B.size)) + 0.5 * (both / new Set([...A, ...B]).size);
}

// "25×50" and "50x25" are the same box tube profile.
const norm = (v: string) => {
  const s = v.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*[×*]\s*|\s+x\s+/g, "x");
  const dims = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(.*)$/.exec(s);
  return dims ? `${[Number(dims[1]), Number(dims[2])].sort((p, q) => p - q).join("x")}${dims[3]}` : s;
};
const sameValue = (a: string, b: string) => norm(a) === norm(b);

// Three sizes or more that all agree (thread, length and head; teeth, pitch and width) name the
// product even when the words don't: the shop's "M5×10 גלילי" is McMaster's "Hex socket head cap
// screw M5x0.80 x 10" (Harel, 2026-11-06).
const FULL_SPECS = 3;
const FULL_SPECS_BONUS = 16;
// Thread, length and head all agreeing name the screw, whatever language the names are in.
const FASTENER_MATCH = 40;
// Words that make a part something that goes on the product, not the product: "Kraken X60 Back
// Cap" isn't a Kraken X60. Ruled out unless two sizes or more agree.
const ACCESSORY = /\b(caps?|covers?|mounts?|brackets?|housings?|guards?|clamps?|holders?|cases?|plates?|inserts?)\b/i;

// A hidden option field (a gear's Spur / Bevel, Aluminum / Steel) the part's name names one way
// and the item the other.
function hiddenClash(names: string[], item: LinkItem) {
  const words = new Set(names.flatMap((n) => tokens(n)));
  return (item.category?.fields ?? []).some((f) => {
    const mine = item.specs[f.id];
    if (!f.hidden || f.kind !== "options" || !mine) return false;
    const named = (f.options ?? []).filter((o) => tokens(o).length && tokens(o).every((t) => words.has(t)));
    return named.length > 0 && !named.some((o) => sameValue(o, mine));
  });
}

// A belt item named by its length ("HTD 5mm Belt 684mm 9mm") has as many teeth as its length over
// the pitch; a length that doesn't divide is no tooth count a part could name.
function itemSpecs(item: LinkItem): Record<string, string> {
  const { specs } = item;
  if (item.category?.id !== "belts" || specs.teeth || !specs.length) return specs;
  const pitch = /(\d+(?:\.\d+)?)\s*mm/.exec(specs.pitch ?? "")?.[1];
  const teeth = pitch ? Number(specs.length) / Number(pitch) : NaN;
  return { ...specs, teeth: Number.isInteger(teeth) ? String(teeth) : `${specs.length}mm` };
}

export function scoreLink(part: LinkPart, item: LinkItem): { score: number; why: string[] } {
  // A screw is linked only to the same screw: thread, length and head, checked before the same
  // Onshape part (audit, 2026-11-20: McMaster's configurable screws are one Onshape part for
  // every length, so an M5×35 button head was suggested as the "M5×10 כיפה" linked before).
  const fastener = fastenerMatch(partFastener(part.names), itemFastener({ name: item.name, specs: item.specs, categoryId: item.category?.id }));
  if (fastener.result === "clash") return { score: 0, why: [] };
  if (part.onshapeKey && part.onshapeKey === item.onshapeKey) return { score: CERTAIN, why: ["same Onshape part"] };
  const urls = new Set(part.urls.map(normUrl));
  if (urls.size && item.urls.some((u) => urls.has(normUrl(u)))) return { score: CERTAIN, why: ["same product link"] };

  let score = 0;
  const why: string[] = [];
  if (fastener.result === "match") {
    score += FASTENER_MATCH;
    why.push(fastener.why);
  }

  // Sizes in the part's name must agree with the item's.
  const agree: string[] = [];
  if (item.category) {
    const specs = itemSpecs(item);
    for (const n of part.names) {
      const found = parseSpecs(n, item.category);
      for (const [field, value] of Object.entries(found)) {
        const mine = specs[field];
        if (!mine) continue;
        if (!sameValue(mine, value)) return { score: 0, why: [] };
        if (!agree.includes(value)) agree.push(value);
      }
    }
    if (hiddenClash(part.names, item)) return { score: 0, why: [] };
    if (agree.length) {
      score += 12 * agree.length + (agree.length >= FULL_SPECS ? FULL_SPECS_BONUS : 0);
      why.push(`${agree.join(", ")} match`);
    }
  }
  if (agree.length < 2 && part.names.some((n) => ACCESSORY.exec(n) && ![item.name, ...item.aliases].some((m) => m.toLowerCase().includes(ACCESSORY.exec(n)![0].toLowerCase()))))
    return { score: 0, why: [] };

  const likeness = Math.max(0, ...part.names.flatMap((n) => [item.name, ...item.aliases].map((m) => nameLikeness(n, m))));
  if (likeness > 0) {
    score += Math.round(50 * likeness);
    why.push(likeness === 1 ? "same name" : "similar name");
  }

  // Raw Stock is what a part is cut from, not what it is: its picture or Part Studio says nothing
  // (small parts' thumbnails look alike; a bearing linked to PLA filament). Suggest's shape rules
  // link in-house parts to Raw Stock.
  if (item.category?.group === "consumables") return { score, why };

  if (part.thumbHash) {
    const twin = item.thumbHashes.find((t) => hashDistance(t.hash, part.thumbHash!) <= 5);
    if (twin) {
      score += 45;
      why.push(`same picture as ${twin.partName}`);
    }
  }

  const doc = item.onshapeKey?.split(":").slice(0, 2).join(":");
  if (part.docKey && (part.docKey === doc || item.docKeys.includes(part.docKey))) {
    score += 15;
    why.push("same Onshape library document");
  }
  return { score, why };
}

// Two items with the same name and specs are the same product entered twice ("24T 9mm HTD
// Pulley" ×4): they don't make each other a near tie; the one with more linked parts wins.
const twinKey = (i: LinkItem) => `${normName(i.name)}|${JSON.stringify(Object.entries(i.specs).sort())}`;
const linkedCount = (i: LinkItem) => i.docKeys.length + i.thumbHashes.length;

// Each part's best item, when it clears the bar and no other item comes close.
export function bestLinks(parts: LinkPart[], items: LinkItem[], skip: (partId: string, itemId: string) => boolean = () => false) {
  return parts.flatMap((p) => {
    const all = items
      .filter((i) => !skip(p.id, i.id))
      .map((i) => ({ item: i, ...scoreLink(p, i) }))
      .filter((s) => s.score >= LINK_THRESHOLD)
      .sort((a, b) => b.score - a.score || linkedCount(b.item) - linkedCount(a.item) || a.item.id.localeCompare(b.item.id));
    const seen = new Set<string>();
    const scored = all.filter((s) => !seen.has(twinKey(s.item)) && !!seen.add(twinKey(s.item)));
    const [best, next] = scored;
    if (!best || (next && best.score < CERTAIN && next.score > best.score - 5)) return [];
    return [{ partId: p.id, itemId: best.item.id, score: Math.min(best.score, CERTAIN), why: best.why }];
  });
}
