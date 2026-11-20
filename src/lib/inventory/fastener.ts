// Screws, nuts and washers by what makes two of them the same product: thread, length and head
// (audit, 2026-11-20: a button head M5×35 was suggested as the shop's "M5×10 כיפה", an M5×6 as
// M5×10). Reads English vendor names ("Socket button head screw M5x0.8 x 35", "M5x16 SHCS",
// "#10-32 x 1/2\" BHCS") and the shop's Hebrew ones ("M5×10 כיפה", "M5×20 גלילי"). Used by
// auto-link and Suggest (linkScore.ts), a member's Claude linking through MCP, and search
// (searchWords.ts), so a link and a search read a screw the same way.

export type FastenerHead = "button" | "socket" | "flat" | "hex" | "set" | "low";
export type FastenerKind = "screw" | "nut" | "washer" | "standoff";
export type Fastener = { kind: FastenerKind; thread: string | null; pitch: string | null; length: string | null; head: FastenerHead | null };

// Most specific first: a "socket button head" is a button head, a "hex socket head cap screw" a
// socket head, a "low head socket cap screw" a low head.
const HEADS: [FastenerHead, RegExp][] = [
  ["button", /button|\bbhcs\b|\bbhs\b|כיפה|כיפתי/],
  ["flat", /\bflat\b|countersunk|\bcsk\b|\bfhcs\b|קוני|שקוע/],
  ["set", /set\s*screw|\bgrub\b|\bsss\b/],
  ["low", /low\s*head|\blhcs\b/],
  ["hex", /\bhex\s+(?:head|bolt|cap\s*screw)\b|\bhhcs\b|משושה/],
  ["socket", /socket\s*head|socket\s*cap|\bshcs\b|cap\s*screw|גלילי|רגיל/],
];

// The words each head is known by, in both languages: search finds an item by any of them
// (an English search finds "M5×10 כיפה", a Hebrew one "Button head screw M5x10").
export const HEAD_WORDS: Record<FastenerHead, string> = {
  button: "button head bhcs כיפה",
  socket: "socket head cap screw shcs גלילי",
  flat: "flat head countersunk fhcs קוני",
  hex: "hex head bolt משושה",
  set: "set screw grub",
  low: "low head",
};
export const HEAD_LABEL: Record<FastenerHead, string> = {
  button: "button head",
  socket: "socket head",
  flat: "flat head",
  hex: "hex head",
  set: "set screw",
  low: "low head",
};

const SCREW = /screws?|\bbolts?\b|בורג|ברג|\bshcs\b|\bbhcs\b|\bfhcs\b|\bhhcs\b/;
const NUT = /\bnuts?\b|nylock|(?<![\u0590-\u05ff])אום/;
const WASHER = /washers?|דסקית|דסקיות/;
const STANDOFF = /standoffs?/;
// A product a size like "M5x20" may appear in that isn't a fastener.
const OTHER = /gear|pulley|sprocket|bearing|wheel|motor|belt|tube|plate|collar|\bhub\b|clamp|bracket|mount|spacer|\btap\b|drill|mill|key|wrench|rivet|insert|מברז|מקדח|ניט/;

// Metric: "M5", "M5x35", "M5×35mm", "M5 x 35", "M5x0.8x35", "M5x0.80 x 35", "M5-0.8 x 35".
const METRIC = /(?<![a-z0-9])m(\d{1,2}(?:\.\d)?)(?:\s*[x×*-]\s*(\d\.\d{1,2})(?=\s*[x×*]))?(?:\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?(?![\d.a-z]))?/;
const METRIC_THREAD = /(?<![a-z0-9])m(\d{1,2}(?:\.\d)?)(?![\d.]|[a-wyz])/;
// Imperial: "#10-32 x 1/2\"", "1/4\"-20 x 1\"", "1/4-20 x 0.75 in".
const IMPERIAL = /(#\d{1,2}|\d\/\d{1,2})\s*"?\s*-\s*(\d{2})(?:\s*[x×*]\s*(\d+(?:\.\d+)?(?:\/\d+)?|\d+\s+\d\/\d+)\s*(?:"|''|in(?:ch(?:es)?)?\b|mm\b)?)?/;

const num = (s: string) => String(Number(s));

// The head a text names ("Button Head (כיפה)", "M5×20 גלילי"), if any.
export const headOf = (text: string): FastenerHead | null => HEADS.find(([, re]) => re.test(text.toLowerCase()))?.[0] ?? null;

// The fastener a name describes, or null when it isn't one.
export function parseFastener(text: string | null | undefined): Fastener | null {
  const t = (text ?? "").toLowerCase().replace(/[״"”]/g, '"');
  if (!t.trim()) return null;
  let thread: string | null = null;
  let pitch: string | null = null;
  let length: string | null = null;
  const m = METRIC.exec(t);
  if (m) {
    thread = `M${m[1]}`;
    pitch = m[2] ? num(m[2]) : null;
    // "M5x0.8" alone is the thread and its pitch, not an 0.8 mm long screw.
    if (m[3] && !(m[3].includes(".") && Number(m[3]) < 2)) length = num(m[3]);
    else if (m[3]) pitch = num(m[3]);
  } else {
    const i = IMPERIAL.exec(t);
    if (i) {
      thread = `${i[1]}-${i[2]}`;
      length = i[3] ? `${i[3].replace(/\s+/g, " ")}"` : null;
    } else {
      const bare = METRIC_THREAD.exec(t);
      if (bare) thread = `M${bare[1]}`;
    }
  }
  const head = headOf(t);
  // "Shaft collar, set screw", "M5 tap": another product that names a screw or a thread.
  if (OTHER.test(t) && !(thread && (head || SCREW.test(t)))) return null;
  // A named head makes it a screw even next to "nuts" (the category "Screws & nuts" in a search text).
  const kind: FastenerKind | null =
    head && (thread || SCREW.test(t))
      ? "screw"
      : NUT.test(t)
        ? "nut"
        : WASHER.test(t)
          ? "washer"
          : // "8mm Aluminum standoff stock" is Raw Stock an in-house spacer is cut from.
            STANDOFF.test(t) && thread && !/\bstock\b/.test(t)
            ? "standoff"
            : SCREW.test(t) || (thread && length && !OTHER.test(t))
              ? "screw"
              : null;
  if (!kind) return null;
  return { kind, thread, pitch, length, head: kind === "screw" ? head : null };
}

// An inventory item's fastener: its name, with what the name leaves out filled from its specs
// (thread, length and the Kind option "Button Head (כיפה)") when it's in Screws & nuts.
export function itemFastener(item: { name: string; specs?: Record<string, string> | null; categoryId?: string | null }): Fastener | null {
  const own = parseFastener(item.name);
  const specs = item.specs ?? {};
  if (item.categoryId !== "fasteners") return own;
  const kind: FastenerKind = own?.kind ?? (specs.kind && /nut|washer/i.test(specs.kind) ? "nut" : "screw");
  const thread = own?.thread ?? (specs.thread ? (parseFastener(`${specs.thread} screw`)?.thread ?? specs.thread) : null);
  return {
    kind,
    thread,
    pitch: own?.pitch ?? null,
    length: own?.length ?? (specs.length && kind === "screw" ? num(specs.length) : null),
    head: kind === "screw" ? (own?.head ?? (specs.kind ? headOf(specs.kind) : null)) : null,
  };
}

// The first of a part's names (its name, then its Onshape name) that reads as a fastener, with
// what it leaves out filled from the others.
export function partFastener(names: (string | null | undefined)[]): Fastener | null {
  const read = names.map(parseFastener).filter((f): f is Fastener => !!f);
  if (!read.length) return null;
  const [first, ...rest] = read;
  const fill = <K extends keyof Fastener>(k: K) => first[k] ?? rest.find((f) => f.kind === first.kind && f[k])?.[k] ?? null;
  return { kind: first.kind, thread: fill("thread"), pitch: fill("pitch"), length: fill("length"), head: fill("head") as FastenerHead | null };
}

export const fastenerText = (f: Fastener) =>
  [f.thread && f.length ? `${f.thread}×${f.length}` : f.thread, f.head ? HEAD_LABEL[f.head] : f.kind === "screw" ? null : f.kind].filter(Boolean).join(" ");

// Whether a part may be linked to an item as far as fasteners go: "none" when neither is one
// (other rules decide), "match" when both are the same fastener, else "clash" with what differs.
// A screw link needs thread, length and head all known and equal (audit, 2026-11-20): "M5x35"
// alone or a picture that looks alike isn't enough to say which screw it is.
export function fastenerMatch(part: Fastener | null, item: Fastener | null): { result: "none" } | { result: "match"; why: string } | { result: "clash"; why: string } {
  if (!part && !item) return { result: "none" };
  if (!part) return { result: "clash", why: `the item is a fastener (${fastenerText(item!)}) and the part's name doesn't say which` };
  if (!item) return { result: "clash", why: `the part is a fastener (${fastenerText(part)}) and the item isn't` };
  if (part.kind !== item.kind) return { result: "clash", why: `a ${part.kind} isn't a ${item.kind}` };
  const fields: (keyof Fastener)[] = part.kind === "screw" ? ["thread", "length", "head"] : part.kind === "standoff" ? ["thread", "length"] : ["thread"];
  for (const f of fields) {
    if (!part[f] || !item[f]) return { result: "clash", why: `the ${f === "head" ? "head" : f} isn't known on ${!part[f] ? "the part" : "the item"}` };
    if (part[f] !== item[f]) return { result: "clash", why: `${f} ${part[f]} vs ${item[f]}` };
  }
  if (part.pitch && item.pitch && part.pitch !== item.pitch) return { result: "clash", why: `pitch ${part.pitch} vs ${item.pitch}` };
  return { result: "match", why: `${fastenerText(part)} match` };
}

// Search text: fastener sizes written one way ("M5x0.8 x 35", "M5 x 35mm", "M5×35") become
// "m5x35", so any of them finds the others. Expects lower case with × already turned into x.
export const fastenerKey = (s: string) =>
  s.replace(/(?<![a-z0-9])m(\d{1,2}(?:\.\d)?)(?:\s*[x*-]\s*\d\.\d{1,2}(?=\s*[x*]))?\s*[x*]\s*(\d+(?:\.\d+)?)(?:\s*mm\b)?/g, (all, d: string, l: string) =>
    l.includes(".") && Number(l) < 2 ? all : `m${d}x${num(l)}`,
  );

// The words a fastener's head is also known by, for search ("" when the text isn't a screw with a head).
export function fastenerSearchWords(text: string): string {
  const f = parseFastener(text);
  return f?.head ? HEAD_WORDS[f.head] : "";
}
