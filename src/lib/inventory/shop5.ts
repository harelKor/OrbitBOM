import "server-only";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { db, schema } from "@/db";
import type { CategoryField } from "@/db/schema";
import { recordItemChanges } from "./history";

// One-off (Harel, 2026-10-28): the shop in 5 groups with sub-types. Every live category takes its
// config/inventory.ts fields, labels and group (keeping its picture, location and the team's
// extra options); items move into the new categories with their type and specs filled; COTS
// cards follow; the emptied old categories go. A field that's dropped but still holds values
// stays, hidden. Runs from /api/cron/inventory-seed (?step=shop5&dry=1, then ?step=shop5).

const { inventoryItems, inventoryCategories, onshapeCache, parts } = schema;
const BACKUP = "inventory-seed:shop5-backup-2026-10-28";
const ctx = { memberId: null, via: "sync" as const };
const OBSOLETE = [
  "shop-supplies",
  "batteries",
  "electrical",
  "power-tools",
  "chain",
  "custom-fabricated-drive",
  "general",
  "bumper-materials",
  "field-elements",
  "hubs-spacers",
  "pinions-adapters",
];

type Item = typeof inventoryItems.$inferSelect;
type Specs = Record<string, string>;
type Move = { category: string; specs: Specs };

const num = (v: string | undefined) => v?.match(/\d+(?:\.\d+)?/)?.[0];
const title = (v: string) => v[0].toUpperCase() + v.slice(1);

// Item specs under the new field ids, by the item's current category. Keys not set here keep
// their values (they become hidden fields when the category no longer has them).
function moveItem(item: Item): Move {
  const n = item.name;
  const s: Specs = { ...item.specs };
  const take = (...keys: string[]) => keys.forEach((k) => delete s[k]);
  switch (item.category) {
    case "fasteners": {
      if (/rivet/i.test(n) || /rivet/i.test(s.head ?? "")) {
        const d = num(s.size);
        const out: Specs = {
          diameter: d === "4" ? '4mm (5/32")' : d === "5" ? '5mm (3/16")' : "",
          head: /large/i.test(`${s.head} ${n}`) ? "Large head (ראש גדול)" : "Standard",
          length: s.length ?? "",
        };
        return { category: "rivets", specs: clean(out) };
      }
      const kind = /wood/i.test(`${s.size} ${n}`)
        ? "Wood Screw"
        : { Socket: "SHCS (רגיל)", Button: "Button Head (כיפה)", Flat: "Flat Head (קוני)" }[s.head ?? ""];
      const thread = /wood/i.test(s.size ?? "") ? undefined : s.size;
      take("head", "size");
      return { category: "fasteners", specs: clean({ kind: kind ?? "", thread: thread ?? "", ...s }) };
    }
    case "shop-supplies":
      return shopSupply(n, s);
    case "electrical":
    case "batteries": {
      if (/main breaker/i.test(n)) return { category: "power-distribution", specs: { type: "Main Breaker", rating: `${num(n)}A` } };
      if (/breaker|fuse/i.test(n)) return { category: "power-distribution", specs: { type: "Fuse / Snap Breaker", rating: s.size ?? `${num(n)}A` } };
      if (/battery/i.test(n) && !/beak/i.test(n)) return { category: "power-distribution", specs: { type: "Battery" } };
      return { category: "controllers", specs: {} };
    }
    case "controllers":
      return /camera|cancoder|candi\b|pigeon|hall|limelight|encoder/i.test(n) ? { category: "sensors", specs: s } : { category: "controllers", specs: s };
    case "power-tools":
      return { category: "hand-tools", specs: {} };
    case "chain":
      return { category: "sprockets", specs: s };
    case "hand-tools":
      return { category: "hand-tools", specs: handTool(n, s) };
    case "cnc-bits": {
      const t = s.type ?? "";
      if (/cnc drill/i.test(t)) return { category: "drills-taps", specs: { type: "Drill Bit", size: num(s.size) ?? "" } };
      const kind = /1-flute/i.test(t)
        ? /long/i.test(n)
          ? "Single Flute Long"
          : "Single Flute"
        : /back chamfer/i.test(t)
          ? "Reverse Chamfer"
          : /chamfer/i.test(t)
            ? "Chamfer"
            : /thread/i.test(t)
              ? "Thread Mill"
              : /collet/i.test(t)
                ? "Collet"
                : "";
      take("type");
      return { category: "cnc-bits", specs: clean({ kind, ...s }) };
    }
    case "lathe-tools": {
      const kind = /parting/i.test(n)
        ? "Parting"
        : /circlip|c-clip/i.test(n)
          ? "C-Clip"
          : /threading insert/i.test(n)
            ? "Threading"
            : /boring insert/i.test(n)
              ? "Internal"
              : /finishing/i.test(n)
                ? "Light Cutter"
                : /roughing/i.test(n)
                  ? "Rough Cutter"
                  : /holder|boring bar/i.test(n)
                    ? "Holder"
                    : /center/i.test(n)
                      ? "Center"
                      : "";
      const material = s.for ?? "";
      take("for");
      return { category: "lathe-tools", specs: clean({ kind, material, ...s }) };
    }
    case "drills-taps": {
      const tap = /tap/i.test(s.kind ?? n);
      const out: Specs = tap ? { type: "Tap", thread: s.size ?? "" } : { type: "Drill Bit", size: num(s.size) ?? "" };
      take("kind", "size");
      return { category: "drills-taps", specs: clean({ ...out, ...s }) };
    }
    case "wiring":
      return { category: "wiring", specs: wire(n, s) };
    case "hubs-adapters": {
      const kind = /spacer/i.test(n) ? "Spacer" : /bearing block/i.test(n) ? "Bearing Block" : /hub/i.test(n) ? "Hex Hub" : "Shaft Adapter";
      const bore = s.from ?? "";
      take("kind", "from");
      return { category: "hubs-adapters", specs: clean({ kind, bore, ...s }) };
    }
    case "gearboxes": {
      const system = s.type === "MAXPlanetary" ? "MaxPlanetary" : (s.type ?? "");
      take("type");
      return { category: "gearboxes", specs: clean({ system, ...s }) };
    }
    case "belts": {
      const groove = s.sides ?? "";
      take("sides");
      return { category: "belts", specs: clean({ ...s, groove }) };
    }
    case "bearings": {
      if (s.id && !s.bore && BEARING_BORE.has(s.id)) {
        const bore = s.id;
        take("id");
        return { category: "bearings", specs: { bore, ...s } };
      }
      return { category: "bearings", specs: s };
    }
    case "wheels": {
      const d = n.match(/\b(\d{2})A\b/)?.[1];
      return { category: "wheels", specs: d && !s.durometer ? { ...s, durometer: `${d}A` } : s };
    }
    case "wood-composites":
      return { category: "wood-composites", specs: s.material === "Sandwich" ? { ...s, material: "Sandwich/Plywood" } : s };
    case "aluminum-plates":
    case "polycarbonate": {
      const t = n.match(/(\d+(?:\.\d+)?)\s*mm/)?.[1];
      return { category: item.category, specs: t && !s.thickness ? { ...s, thickness: t } : s };
    }
    default:
      return { category: item.category ?? "other", specs: s };
  }
}

const BEARING_BORE = new Set(DEFAULT_CATEGORIES.find((c) => c.id === "bearings")!.fields[0].options);

const clean = (s: Specs) => Object.fromEntries(Object.entries(s).filter(([, v]) => v));

function shopSupply(n: string, s: Specs): Move {
  const glue = (kind: string) => ({ category: "adhesives-tapes", specs: clean({ type: "Glue", glue: kind }) });
  if (/zip tie/i.test(n)) {
    const size = /2\.5×100/.test(n) ? "Small" : /3\.6×150/.test(n) ? "Medium" : "";
    return { category: "rigging-ties", specs: clean({ type: "Zip Tie", size }) };
  }
  if (/dyneema|rope/i.test(n)) return { category: "rigging-ties", specs: clean({ type: "Rope", diameter: num(s.size) ?? "" }) };
  if (/tread/i.test(n)) return { category: "wheels", specs: { type: "Tread" } };
  if (/solder/i.test(n)) return { category: "wiring", specs: {} };
  if (/duct/i.test(n)) return { category: "adhesives-tapes", specs: { type: "Tape", tape: "Duct Tape" } };
  if (/electrical tape|insulation tape/i.test(n)) return { category: "adhesives-tapes", specs: { type: "Tape", tape: "Electrical" } };
  if (/tape/i.test(n)) return { category: "adhesives-tapes", specs: { type: "Tape" } };
  if (/epoxy/i.test(n)) return glue("Epoxy");
  if (/\bCA glue\b/i.test(n) && !/accelerator/i.test(n)) return glue("Super Glue (CA)");
  if (/glue/i.test(n) && !/accelerator/i.test(n)) return glue("");
  if (/acetone|alcohol|lubricant|accelerator/i.test(n)) return { category: "adhesives-tapes", specs: { type: "Spray & Solvent" } };
  return { category: "adhesives-tapes", specs: {} };
}

function handTool(n: string, s: Specs): Specs {
  const size = s.size;
  if (/allen key/i.test(n)) return clean({ type: "Allen Key", size: size ?? "", keyStyle: "L-Key" });
  if (/socket/i.test(n)) return clean({ type: "Wrench", wrenchStyle: "Socket", size: size ?? (n.match(/(\d+)mm/)?.[1] ? `${n.match(/(\d+)mm/)![1]}mm` : "") });
  if (/^wrench/i.test(n)) return clean({ type: "Wrench", size: size ?? "", wrenchStyle: "Combination" });
  if (/stripper/i.test(n)) return { type: "Crimper", for: "Stripper" };
  if (/crimper/i.test(n))
    return clean({ type: "Crimper", for: /anderson/i.test(n) ? "Anderson" : /ferrule/i.test(n) ? "Ferrule (סופיות)" : /lug/i.test(n) ? "Ring Terminal" : "" });
  if (/plier|cutter|scissors|knife/i.test(n)) return { type: "Pliers & Cutters" };
  if (/caliper|square|angle gauge|level|multimeter|scale|tape measure/i.test(n)) return { type: "Measuring" };
  return {};
}

function wire(n: string, s: Specs): Specs {
  const kind = s.kind ?? "";
  const awg = s.gauge ? `${s.gauge} AWG` : /^CAN wire/i.test(n) ? "CAN" : "";
  const rest = { ...s };
  delete rest.kind;
  delete rest.gauge;
  const color = n.match(/\b(red|black)\b/i)?.[1];
  if (kind === "Ferrule") return clean({ type: "Ferrule (סופית)", awg, ...rest });
  if (kind === "Ring terminal" || kind === "Lug") return clean({ type: "Ring Terminal (נעל כבל)", awg, ...rest });
  if (kind === "Wire" || kind === "Cable") return clean({ type: "Wire", awg, color: color ? title(color.toLowerCase()) : "", ...rest });
  if (/heat shrink/i.test(n)) return clean({ type: "Heat Shrink", ...rest });
  if (kind === "Contact" || kind === "Housing" || kind === "Connector") {
    const series = /anderson|sb120/i.test(n) ? "Anderson" : /\bCAN\b|PWM/.test(n) ? "PWM / CAN" : "";
    return clean({ type: "Connector", series, ...rest });
  }
  return rest;
}

// The config's fields for a category, with the live one's extra options, then its other fields
// that items still use, hidden.
function fieldsFor(id: string, live: CategoryField[], used: Set<string>): CategoryField[] {
  const seed = DEFAULT_CATEGORIES.find((c) => c.id === id);
  if (!seed) return live;
  const fields = seed.fields.map((f) => {
    const mine = live.find((o) => o.id === f.id && o.kind === f.kind);
    const extra = (mine?.options ?? []).filter((o) => f.options && !f.options.includes(o) && used.has(`${f.id}=${o}`));
    return extra.length ? { ...f, options: [...f.options!, ...extra] } : f;
  });
  const kept = [...used].map((k) => k.split("=")[0]).filter((k, i, a) => a.indexOf(k) === i && !fields.some((f) => f.id === k));
  return [
    ...fields,
    ...kept.map((k): CategoryField => {
      const mine = live.find((o) => o.id === k);
      return mine ? { ...mine, hidden: true } : { id: k, label: title(k), kind: "text", hidden: true };
    }),
  ];
}

export async function shop5(dry: boolean) {
  const live = await db.select().from(inventoryCategories);
  const items = await db.select().from(inventoryItems);
  const moves = items.map((item) => ({ item, ...moveItem(item) }));
  const changed = moves.filter((m) => m.category !== m.item.category || JSON.stringify(m.specs) !== JSON.stringify(m.item.specs));

  // Values by category after the moves, for the fields to keep.
  const used = new Map<string, Set<string>>();
  for (const m of moves) {
    const set = used.get(m.category) ?? new Set<string>();
    for (const [k, v] of Object.entries(m.specs)) if (v) set.add(`${k}=${v}`);
    used.set(m.category, set);
  }
  const seedIds = DEFAULT_CATEGORIES.map((c) => c.id);
  const cats = DEFAULT_CATEGORIES.map((seed, position) => {
    const mine = live.find((c) => c.id === seed.id);
    return {
      id: seed.id,
      label: seed.label,
      noun: seed.noun,
      group: seed.group,
      sheet: !!seed.sheet,
      position,
      image: mine?.image ?? seed.image ?? null,
      defaultLocationId: mine?.defaultLocationId ?? null,
      fields: fieldsFor(seed.id, mine?.fields ?? [], used.get(seed.id) ?? new Set()),
      isNew: !mine,
    };
  });
  // The team's own categories stay, after the config's, in a real group.
  const theirs = live.filter((c) => !seedIds.includes(c.id) && !OBSOLETE.includes(c.id));
  const leftover = moves.filter((m) => !seedIds.includes(m.category) && !theirs.some((c) => c.id === m.category));

  const cards = await db
    .select({ id: parts.id, name: parts.displayName, cotsCategory: parts.cotsCategory, itemId: parts.inventoryItemId })
    .from(parts)
    .where(inArray(parts.cotsCategory, OBSOLETE.concat("controllers")));
  const cardMoves = cards
    .map((p) => {
      const linked = moves.find((m) => m.item.id === p.itemId);
      const category = linked?.category ?? (p.cotsCategory === "controllers" ? "controllers" : (moveItem({ name: p.name ?? "", category: p.cotsCategory, specs: {} } as Item).category ?? "other"));
      return { id: p.id, from: p.cotsCategory, category: seedIds.includes(category) ? category : "other" };
    })
    .filter((c) => c.category !== c.from);

  if (dry)
    return {
      categories: cats.map((c) => `${c.id}${c.isNew ? " (new)" : ""} [${c.group}] ${c.label}: ${c.fields.map((f) => `${f.id}${f.hidden ? "(hidden)" : ""}${f.when ? `<${[f.when].flat().join("/")}>` : ""}`).join(", ")}`),
      theirs: theirs.map((c) => c.id),
      leftover: leftover.map((m) => `${m.item.name} (${m.category})`),
      items: changed.map((m) => `${m.item.category} → ${m.category}: ${m.item.name} ${JSON.stringify(m.specs)}`),
      cards: cardMoves.map((c) => `${c.from} → ${c.category}`),
      deleting: live.filter((c) => OBSOLETE.includes(c.id)).map((c) => c.id),
    };
  if (leftover.length) return { error: "Items would be left in a deleted category.", leftover: leftover.map((m) => m.item.name) };

  await db.transaction(async (tx) => {
    const [had] = await tx.select().from(onshapeCache).where(eq(onshapeCache.key, BACKUP));
    if (!had)
      await tx.insert(onshapeCache).values({
        key: BACKUP,
        payload: { categories: live, items: changed.map((m) => ({ id: m.item.id, category: m.item.category, specs: m.item.specs })), cards },
      });
    for (const { isNew, ...c } of cats) {
      if (isNew) await tx.insert(inventoryCategories).values(c);
      else await tx.update(inventoryCategories).set(c).where(eq(inventoryCategories.id, c.id));
    }
    for (const [i, c] of theirs.entries())
      await tx
        .update(inventoryCategories)
        .set({ position: cats.length + i, ...(DEFAULT_CATEGORIES.some((s) => s.group === c.group) ? {} : { group: "hardware" }) })
        .where(eq(inventoryCategories.id, c.id));
    for (const m of changed) {
      const values = { category: m.category, specs: m.specs };
      await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, m.item.id));
      await recordItemChanges(tx, m.item.id, m.item, values, ctx);
    }
    for (const c of cardMoves) await tx.update(parts).set({ cotsCategory: c.category }).where(eq(parts.id, c.id));
    await tx.delete(inventoryCategories).where(inArray(inventoryCategories.id, OBSOLETE));
  });
  return { itemsChanged: changed.length, cardsMoved: cardMoves.length, categories: cats.length, deleted: live.filter((c) => OBSOLETE.includes(c.id)).map((c) => c.id) };
}
