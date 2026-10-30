// Smart typing in the add box: "36t htd 1/2 hex pulley" → Pulleys, teeth 36, pitch HTD 5mm,
// bore 1/2" Hex. Plain pattern matching, no AI. Option fields go first (each claims the words it
// used), then number fields read the rest through their name pattern ("{}T" reads "36t").
// Shop words go first: "5 min epoxy" is a Glue, Epoxy, 5 Min; "Loctite 243" is Blue; "M5 tap" a Tap.

import { guessCategory } from "@/config/inventory";
import { activeFields, fieldChoices, isSize, takesSizes, type InvCategory } from "./categories";

const UNIT = /^\d+(\.\d+)?(mm|in|t)?$/;
const FRACTIONS: Record<string, string> = { "½": "1/2", "⅜": "3/8", "¼": "1/4", "¾": "3/4", "⅝": "5/8" };

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[½⅜¼¾⅝]/g, (c) => ` ${FRACTIONS[c]} `)
    .replace(/(\d)\s*(?:"|''|inch(es)?\b)/g, "$1 in ")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 $2")
    .split(/[^a-z0-9/.#]+/)
    .filter((t) => t && t !== "in" && t !== "x");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pickOption(choices: string[], words: string[]): { value: string; used: string[] } | null {
  let best: { value: string; used: string[]; score: number } | null = null;
  for (const choice of choices) {
    const want = tokens(choice);
    if (!want.length) continue;
    const used = want.filter((t) => words.includes(t));
    const score = used.length / want.length;
    // A part match needs a real word (htd, hex, 6061), not just a size that many options share.
    if (score < 1 && (score < 0.5 || !used.some((t) => (/[a-z]/.test(t) && !UNIT.test(t)) || /^\d{4}$/.test(t)))) continue;
    if (!best || score > best.score || (score === best.score && want.length > tokens(best.value).length)) best = { value: choice, used, score };
  }
  return best && { value: best.value, used: best.used };
}

// left: the words it couldn't place (the category's own name doesn't count). None left means the
// whole line was understood, so Enter can save it straight away.
export type QuickParse = { categoryId: string; specs: Record<string, string>; left: string[] };

export function parseQuick(text: string, cats: InvCategory[]): QuickParse | null {
  const lower = text.toLowerCase();
  const named = cats.find((c) => [c.noun, c.label].some((w) => w && new RegExp(`\\b${escape(w.toLowerCase())}s?\\b`).test(lower)));
  const categoryId = named?.id ?? guessCategory(text, cats.map((c) => c.id));
  const cat = cats.find((c) => c.id === categoryId);
  if (!cat) return null;

  const shop = shopWords(text, cat);
  const { specs, rest } = readSpecs(shop.rest, cat, shop.specs);
  const own = new Set([cat.noun, cat.label].flatMap((w) => tokens(w ?? "")).flatMap((w) => [w, `${w}s`, w.replace(/s$/, "")]));
  return { categoryId: cat.id, specs, left: tokens(rest).filter((w) => !own.has(w)) };
}

// The category's field values found in a piece of text (a BOM part's name, for auto-link).
export const parseSpecs = (text: string, cat: InvCategory) => {
  const shop = shopWords(text, cat);
  return readSpecs(shop.rest, cat, shop.specs).specs;
};

type Rule = [RegExp, (m: RegExpExecArray) => Record<string, string>];
const mm = (n: string) => `${n}mm`;
// Words the shop uses for a category's sub-types and values, by category id. A rule's values
// that the category doesn't offer are left out (a size like a bearing's "11" ID is kept as typed
// when the field's options are sizes), and the words it matched are used up.
// Base materials by the words people type for them (only those the field offers are kept).
const MATERIAL_WORDS: Rule[] = [
  [/carbon(\s*fib(er|re))?|קרבון/, () => ({ material: "Carbon Fiber" })],
  [/polycarb\w*|\bpoly\b|lexan|פוליקרבונט/, () => ({ material: "Polycarbonate" })],
  [/stainless|\bss\b|נירוסטה/, () => ({ material: "Stainless Steel" })],
  [/\bsteel\b|פלדה/, () => ({ material: "Steel" })],
  [/\bbrass\b|פליז/, () => ({ material: "Brass" })],
  [/delrin|acetal|\bpom\b/, () => ({ material: "Delrin / Acetal" })],
  [/\bnylon\b/, () => ({ material: "Nylon" })],
  [/\b7075\b/, () => ({ material: "7075-T6" })],
  [/\b6061\b/, () => ({ material: "6061-T6" })],
  [/alumin?i?um|\balu\b|אלומיניום/, () => ({ material: "Aluminum" })],
];
const NUM = "(\\d+(?:\\.\\d+)?)";
const BY = "\\s*(?:mm)?\\s*[x×*]\\s*";
const SHOP_WORDS: Record<string, Rule[]> = {
  // "aluminum 25x2 tube", "carbon Ø20×1.5": OD x wall in mm.
  "round-tubes": [[new RegExp(`ø?\\s*${NUM}${BY}${NUM}(?:\\s*mm\\b)?`), (m) => ({ od: m[1], wall: m[2] })], ...MATERIAL_WORDS],
  // "aluminum 50x50x100 block" (X x Y x Z), "brass Ø30x150 cylinder" (OD x length), "8mm standoff stock".
  "cylinders-blocks": [
    [new RegExp(`${NUM}${BY}${NUM}${BY}${NUM}(?:\\s*mm\\b)?`), (m) => ({ shape: "Block", x: m[1], y: m[2], z: m[3] })],
    [new RegExp(`ø?\\s*${NUM}${BY}${NUM}(?:\\s*mm\\b)?`), (m) => ({ shape: "Cylinder", od: m[1], length: m[2] })],
    [/\bblocks?\b|billet/, () => ({ shape: "Block" })],
    [/cylinders?|standoffs?|\brods?\b|(round|lathe)\s*stock|גליל/, () => ({ shape: "Cylinder" })],
    [new RegExp(`ø\\s*${NUM}|${NUM}\\s*mm\\b`), (m) => ({ shape: "Cylinder", od: m[1] ?? m[2] })],
    ...MATERIAL_WORDS,
  ],
  // "8x16x5", "8×16×5mm", "6.35*17.46*7.9 flanged": ID, OD and thickness in mm.
  bearings: [
    [/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*mm\b)?/, (m) => ({ bore: m[1], od: m[2], width: m[3] })],
    [/flange\w*|פלאנג\S*/, () => ({ flanged: "Flanged" })],
    [/\bradial\b|רדיאל\S*/, () => ({ flanged: "Radial" })],
  ],
  "adhesives-tapes": [
    [/\bepoxy\b|אפוקסי/, () => ({ type: "Glue", glue: "Epoxy" })],
    [/super\s*glue|\bca\b(\s*glue)?/, () => ({ type: "Glue", glue: "Super Glue (CA)" })],
    [/hot\s*glue|דבק\s*חם/, () => ({ type: "Glue", glue: "Hot Glue" })],
    [/structural/, () => ({ type: "Glue", glue: "Structural" })],
    [/\b(\d+)\s*min(ute)?s?\b/, (m) => ({ type: "Glue", cure: `${m[1]} Min` })],
    [/\binstant\b/, () => ({ type: "Glue", cure: "Instant" })],
    [/\b24\s*(h|hr|hours?)\b/, () => ({ type: "Glue", cure: "24 Hr" })],
    [/\bloctite\b|thread\s*lock(er)?/, () => ({ type: "Loctite" })],
    [/\b24[23]\b|\bblue\b/, () => ({ grade: "Blue (Medium)" })],
    [/\b2(62|63|68|71|72|77)\b|\bred\b/, () => ({ grade: "Red (Strong)" })],
    [/\b222\b|\bpurple\b/, () => ({ grade: "Purple (Low)" })],
    [/\b290\b|\bgreen\b/, () => ({ grade: "Green" })],
    [/\bduct\b|דאקט/, () => ({ type: "Tape", tape: "Duct Tape" })],
    [/electrical|insulation|בידוד/, () => ({ type: "Tape", tape: "Electrical" })],
    [/\bvhb\b|double[\s-]*sided|דו[\s-]*צדדי/, () => ({ type: "Tape", tape: "VHB / Double-Sided" })],
    [/kapton/, () => ({ type: "Tape", tape: "Kapton" })],
    [/masking|נייר/, () => ({ type: "Tape", tape: "Masking" })],
    [/\btapes?\b|טייפ/, () => ({ type: "Tape" })],
    [/\bglue\b|דבק/, () => ({ type: "Glue" })],
    [/acetone|alcohol|\bipa\b|spray|solvent|lubric\w*|grease|wd[\s-]*40|אצטון|אלכוהול/, () => ({ type: "Spray & Solvent" })],
  ],
  "rigging-ties": [
    [/zip\s*ties?|cable\s*ties?|אזיקונ?\w*/, () => ({ type: "Zip Tie" })],
    [/heavy\s*duty/, () => ({ type: "Zip Tie", size: "Heavy Duty" })],
    [/\b(small|medium|large)\b/, (m) => ({ size: m[1][0].toUpperCase() + m[1].slice(1) })],
    [/rope|dyneema|cord|חבל/, () => ({ type: "Rope" })],
    [/velcro|סקוץ/, () => ({ type: "Velcro" })],
    [/elastic|surgical\s*tub\w*|bungee|גומי/, () => ({ type: "Tube / Elastic" })],
    [/(\d+(?:\.\d+)?)\s*m\b(?!m)/, (m) => ({ length: m[1] })],
    [/ø?\s*(\d+(?:\.\d+)?)\s*mm\b/, (m) => ({ diameter: m[1] })],
  ],
  rivets: [
    [/\b(\d(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\b/, (m) => ({ diameter: RIVET[m[1]] ?? "", length: m[2] })],
    [/5\/32/, () => ({ diameter: '4mm (5/32")' })],
    [/3\/16/, () => ({ diameter: '5mm (3/16")' })],
    [/large|big|wide\s*head|ראש\s*גדול/, () => ({ head: "Large head (ראש גדול)" })],
  ],
  fasteners: [
    [/\b(m\d)\s*[x×]\s*(\d+(?:\.\d+)?)\b/, (m) => ({ thread: m[1].toUpperCase(), length: m[2] })],
    [/(#\d+-\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\b/, (m) => ({ thread: m[1], length: m[2] })],
    [/button|\bbhcs\b|כיפה/, () => ({ kind: "Button Head (כיפה)" })],
    [/\bflat\b|countersunk|\bfhcs\b|קוני/, () => ({ kind: "Flat Head (קוני)" })],
    [/\bshcs\b|socket\s*head|cap\s*screw|רגיל/, () => ({ kind: "SHCS (רגיל)" })],
    [/\bwood\b|עץ/, () => ({ kind: "Wood Screw" })],
    [/\bnuts?\b|washers?|nylock|אום|דסקית/, () => ({ kind: "Nut / Washer" })],
  ],
  "power-distribution": [
    [/main\s*breaker|\bmain\b/, () => ({ type: "Main Breaker" })],
    [/batter\w*|מצבר/, () => ({ type: "Battery" })],
    [/breakers?|fuses?|פיוז\w*/, () => ({ type: "Fuse / Snap Breaker" })],
    [/\b(\d+(?:\.\d+)?)\s*a(mps?)?\b/, (m) => ({ rating: `${m[1]}A` })],
  ],
  wiring: [
    [/ferrules?|סופי\w*/, () => ({ type: "Ferrule (סופית)" })],
    [/ring\s*terminals?|\blugs?\b|נעל\w*/, () => ({ type: "Ring Terminal (נעל כבל)" })],
    [/heat\s*shrink|שרינק/, () => ({ type: "Heat Shrink" })],
    [/anderson|\bpp\d+\b/, () => ({ type: "Connector", series: "Anderson" })],
    [/\bsb\s*50\b/, () => ({ type: "Connector", series: "SB50" })],
    [/\bwago\b/, () => ({ type: "Connector", series: "Wago" })],
    [/weidm\w*/, () => ({ type: "Connector", series: "Weidmüller" })],
    [/\bpwm\b|\bcan\s*connector/, () => ({ type: "Connector", series: "PWM / CAN" })],
    [/connectors?|מחבר/, () => ({ type: "Connector" })],
    [/\bwires?\b|cable|כבל|חוט/, () => ({ type: "Wire" })],
    [/\b(\d+)\s*(awg|ga(uge)?)\b/, (m) => ({ awg: `${m[1]} AWG` })],
    [/\bcan\b/, () => ({ type: "Wire", awg: "CAN" })],
    [/\b(red|black|white|yellow|green|blue|orange)\b/, (m) => ({ color: m[1][0].toUpperCase() + m[1].slice(1) })],
  ],
  "drills-taps": [
    [/\btaps?\b|מברז\w*/, () => ({ type: "Tap" })],
    [/drill(\s*bit)?s?|מקדח\w*/, () => ({ type: "Drill Bit" })],
    [/(1\/4"?\s*-?\s*20)/, () => ({ type: "Tap", thread: '1/4"-20' })],
    [/ø?\s*(\d+(?:\.\d+)?)\s*mm\b/, (m) => ({ size: m[1] })],
  ],
  "hand-tools": [
    [/allen(\s*keys?)?|hex\s*keys?|אלן/, () => ({ type: "Allen Key" })],
    [/t[\s-]*handle/, () => ({ type: "Allen Key", keyStyle: "T-Handle" })],
    [/ball[\s-]*end/, () => ({ type: "Allen Key", keyStyle: "Ball-End" })],
    [/l[\s-]*key/, () => ({ type: "Allen Key", keyStyle: "L-Key" })],
    [/ratchet/, () => ({ type: "Wrench", wrenchStyle: "Ratchet" })],
    [/socket|בוקסה/, () => ({ type: "Wrench", wrenchStyle: "Socket" })],
    [/adjustable|שוודי/, () => ({ type: "Wrench", wrenchStyle: "Adjustable" })],
    [/combination|רינג/, () => ({ type: "Wrench", wrenchStyle: "Combination" })],
    [/wrench|spanner|מפתח/, () => ({ type: "Wrench" })],
    [/crimp\w*|לוחץ/, () => ({ type: "Crimper" })],
    [/stripper|קולף/, () => ({ type: "Crimper", for: "Stripper" })],
    [/plier\w*|cutters?|snips?|צבת|קטר/, () => ({ type: "Pliers & Cutters" })],
    [/caliper|measur\w*|ruler|square|קליבר|מטר/, () => ({ type: "Measuring" })],
    [/\b(\d+(?:\.\d+)?)\s*mm\b/, (m) => ({ size: mm(m[1]) })],
    [/\b(\d+\/\d+)\s*(?:"|in(ch)?)?(?=\s|$)/, (m) => ({ size: `${m[1]}"` })],
  ],
};
const RIVET: Record<string, string> = { "4": '4mm (5/32")', "4.0": '4mm (5/32")', "5": '5mm (3/16")', "4.8": '5mm (3/16")', "5.0": '5mm (3/16")' };

function shopWords(text: string, cat: InvCategory) {
  const specs: Record<string, string> = {};
  let rest = text.toLowerCase();
  for (const [re, read] of SHOP_WORDS[cat.id] ?? []) {
    const m = re.exec(rest);
    if (!m) continue;
    let took = false;
    for (const [id, value] of Object.entries(read(m))) {
      const field = cat.fields.find((f) => f.id === id);
      if (!field || !value || specs[id]) continue;
      const choices = fieldChoices(field);
      const hit = choices.length ? (choices.find((c) => c.toLowerCase() === value.toLowerCase()) ?? (takesSizes(choices) && isSize(value) ? value : undefined)) : value;
      if (!hit) continue;
      specs[id] = hit;
      took = true;
    }
    if (took) rest = rest.replace(m[0], " ");
  }
  return { specs, rest };
}

function readSpecs(text: string, cat: InvCategory, found: Record<string, string> = {}) {
  let words = tokens(text);
  const specs: Record<string, string> = { ...found };
  // Fields for another sub-type than the one found don't read anything.
  const active = (f: InvCategory["fields"][number]) => activeFields(cat, specs).includes(f);
  for (const f of cat.fields) {
    if (specs[f.id] || (f.kind !== "options" && f.kind !== "material") || !active(f)) continue;
    const hit = pickOption(fieldChoices(f), words);
    if (!hit) continue;
    specs[f.id] = hit.value;
    words = words.filter((w) => !hit.used.includes(w));
  }
  let rest = ` ${words.join(" ")} `;
  for (const f of cat.fields) {
    if (specs[f.id] || f.kind !== "number" || !f.name || !f.name.includes("{}") || !active(f)) continue;
    const [before, after] = f.name.split("{}").map((s) => tokens(s).map(escape).join("\\s*"));
    const m = new RegExp(`\\s${before ? `${before}\\s*` : ""}(\\d+(?:\\.\\d+)?)${after ? `\\s*${after}` : ""}\\s`).exec(rest);
    if (!m || (!before && !after)) continue;
    specs[f.id] = m[1];
    rest = rest.replace(m[0], " ");
  }
  // Values of fields the sub-type doesn't have (a rule can find both) are dropped.
  for (const id of Object.keys(specs)) if (!activeFields(cat, specs).some((f) => f.id === id)) delete specs[id];
  return { specs, rest };
}
