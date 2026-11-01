// Auto-link's guess of which inventory item a BOM part is (Harel, 2026-10-23: "based on any of
// the part's details that might relate them, even if the part isn't fully configured"). Each
// signal adds points; a size in the part's name that disagrees with the item rules the pair out.
// Every guess waits in To Review until someone approves it.

import { hashDistance } from "@/lib/images/dhash";
import type { InvCategory } from "./categories";
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

export function scoreLink(part: LinkPart, item: LinkItem): { score: number; why: string[] } {
  if (part.onshapeKey && part.onshapeKey === item.onshapeKey) return { score: CERTAIN, why: ["same Onshape part"] };
  const urls = new Set(part.urls.map(normUrl));
  if (urls.size && item.urls.some((u) => urls.has(normUrl(u)))) return { score: CERTAIN, why: ["same product link"] };

  let score = 0;
  const why: string[] = [];

  // Sizes in the part's name must agree with the item's.
  if (item.category) {
    const agree: string[] = [];
    for (const n of part.names) {
      const found = parseSpecs(n, item.category);
      for (const [field, value] of Object.entries(found)) {
        const mine = item.specs[field];
        if (!mine) continue;
        if (!sameValue(mine, value)) return { score: 0, why: [] };
        if (!agree.includes(value)) agree.push(value);
      }
    }
    if (agree.length) {
      score += 12 * agree.length;
      why.push(`${agree.join(", ")} match`);
    }
  }

  const likeness = Math.max(0, ...part.names.flatMap((n) => [item.name, ...item.aliases].map((m) => nameLikeness(n, m))));
  if (likeness > 0) {
    score += Math.round(50 * likeness);
    why.push(likeness === 1 ? "same name" : "similar name");
  }

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

// Each part's best item, when it clears the bar and no other item comes close.
export function bestLinks(parts: LinkPart[], items: LinkItem[], skip: (partId: string, itemId: string) => boolean = () => false) {
  return parts.flatMap((p) => {
    const scored = items
      .filter((i) => !skip(p.id, i.id))
      .map((i) => ({ item: i, ...scoreLink(p, i) }))
      .filter((s) => s.score >= LINK_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    const [best, next] = scored;
    if (!best || (next && best.score < CERTAIN && next.score > best.score - 5)) return [];
    return [{ partId: p.id, itemId: best.item.id, score: Math.min(best.score, CERTAIN), why: best.why }];
  });
}
