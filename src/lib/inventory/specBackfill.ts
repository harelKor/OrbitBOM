import "server-only";
import { eq } from "drizzle-orm";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { db, schema } from "@/db";
import type { CategoryField } from "@/db/schema";
import { listCategories } from "@/lib/data/categories";
import { fieldChoices, type InvCategory } from "./categories";
import { recordItemChanges } from "./history";

// One-off (Harel, 2026-10-28): category fields audited against the items in them, item specs
// filled in from names and notes, notes that only said the unit or repeated a size dropped.
// Runs from /api/cron/inventory-seed (?step=audit, ?step=specs&dry=1, ?step=specs).

const { inventoryItems, inventoryCategories, onshapeCache } = schema;
const BACKUP = "inventory-seed:specs-backup-2026-10-28";
const ctx = { memberId: null, via: "sync" as const };

// Every category with its fields and its items' name, specs and note, for reading over.
export async function auditInventory() {
  const cats = await listCategories();
  const items = await db
    .select({
      name: inventoryItems.name,
      category: inventoryItems.category,
      specs: inventoryItems.specs,
      note: inventoryItems.note,
    })
    .from(inventoryItems);
  return cats.map((c) => ({
    id: c.id,
    fields: c.fields.map(
      (f) => `${f.id}:${f.kind}${f.name ? `(${f.name})` : ""}`,
    ),
    items: items
      .filter((i) => i.category === c.id)
      .map((i) =>
        [
          i.name,
          Object.entries(i.specs)
            .map(([k, v]) => `${k}=${v}`)
            .join(";"),
          i.note ?? "",
        ]
          .filter(Boolean)
          .join(" | "),
      )
      .sort(),
  }));
}

// A live category's fields brought up to config/inventory.ts: the config's fields in its order,
// each keeping the team's extra options, label and hidden flag, then the team's own fields.
// Round tubes' "field" (OD) and "field-2" (thickness), added on the settings panel, become od
// and wall.
const RENAMED: Record<string, Record<string, string>> = {
  "round-tubes": { field: "od", "field-2": "wall" },
};

function mergeFields(id: string, live: CategoryField[]): CategoryField[] {
  const seed = DEFAULT_CATEGORIES.find((c) => c.id === id);
  if (!seed) return live;
  const renamed = RENAMED[id] ?? {};
  const own = live.filter((f) => !renamed[f.id]);
  const merged = seed.fields.map((f) => {
    const mine = own.find((o) => o.id === f.id);
    if (!mine) return f;
    const options = f.options && [
      ...f.options,
      ...(mine.options ?? []).filter((o) => !f.options!.includes(o)),
    ];
    return {
      ...f,
      label: mine.label,
      hidden: mine.hidden,
      name: mine.name ?? f.name,
      ...(options && { options }),
    };
  });
  return [
    ...merged,
    ...own.filter((o) => !seed.fields.some((f) => f.id === o.id)),
  ];
}

// What a field change means to the team: ids, kinds, choices, names and labels.
const shape = (fields: CategoryField[]) =>
  JSON.stringify(
    fields.map((f) => [
      f.id,
      f.kind,
      f.label,
      f.name ?? null,
      !!f.hidden,
      f.options ?? null,
      f.materials ?? null,
    ]),
  );

type Item = typeof inventoryItems.$inferSelect;
type Specs = Record<string, string>;

const UNITS: Record<string, string> = {
  במטרים: "Meters",
  מטר: "Meters",
  בפיט: "Feet",
};

// The values an item's name and note give for its category's fields.
function readItem(cat: string, name: string, note: string): Specs {
  const n = name;
  const s: Specs = {};
  const m = (re: RegExp) => re.exec(n);
  const unit = note
    .split(/;\s*/)
    .map((x) => UNITS[x.trim()])
    .find(Boolean);
  switch (cat) {
    case "gears": {
      s.type = /bevel/i.test(n)
        ? "Bevel"
        : /ball shifter/i.test(n)
          ? "Ball shifter"
          : "Spur";
      if (/steel/i.test(n)) s.material = "Steel";
      else if (/alumin/i.test(n)) s.material = "Aluminum";
      if (/SIM shaft/i.test(n)) s.bore = "SIM shaft";
      if (/1\.125" Bearing/i.test(n)) s.bore = '1.125" Bearing';
      const t = m(/(\d+)T\b/);
      if (t) s.teeth = t[1];
      const dp = m(/(\d+)DP/);
      if (dp && ["20", "32"].includes(dp[1])) s.dp = `${dp[1]} DP`;
      if (/1\/2" Hex/.test(n)) s.bore = '1/2" Hex';
      else if (/3\/8" Hex/.test(n)) s.bore = '3/8" Hex';
      break;
    }
    case "pulleys": {
      if (/kraken spline/i.test(n)) s.bore = "Kraken spline";
      if (/falcon spline/i.test(n)) s.bore = "Falcon spline";
      const t = m(/(\d+)T\b/);
      if (t && !/\+/.test(n)) s.teeth = t[1];
      if (/GT2/.test(n)) s.pitch = "GT2 3mm";
      const w = m(/\b(9|15|20)mm\b/);
      if (w) s.width = w[1];
      break;
    }
    case "sprockets": {
      const b = m(/\(([^,]+?) bore/);
      if (b && !/hex/i.test(b[1])) s.boreSize = b[1];
      const t = m(/, ([\d./]+(?:mm|")) thick/);
      if (t) s.thickness = t[1];
      break;
    }
    case "belts": {
      const l = m(/Belt (\d+)mm/);
      if (l) s.length = l[1];
      s.sides = /double-sided/i.test(n) ? "Double-sided" : "Single";
      const t = m(/\((\d+)T\)/);
      if (t) s.teeth = t[1];
      if (/^GT2/.test(n)) s.pitch = "GT2 3mm";
      if (/^HTD/.test(n)) s.pitch = "HTD 5mm";
      const w = m(/\)\s*(\d+)mm/);
      if (w) s.width = w[1];
      break;
    }
    case "bearings": {
      const d = m(/Bearing ([\d.]+)×([\d.]+)×([\d.]+)mm/);
      if (d)
        Object.assign(s, {
          id: `${d[1]}mm`,
          od: `${d[2]}mm`,
          width: `${d[3]}mm`,
        });
      const i = m(/Bearing ([\d.]+"?) × ([\d. /]+"?) × ([\d.]+")/);
      if (i) Object.assign(s, { id: i[1], od: i[2], width: i[3] });
      const f = m(/\(([\d.]+mm) ID, ([\d.]+") OD\)/);
      if (f) Object.assign(s, { id: f[1], od: f[2] });
      if (/flanged/i.test(n)) s.flanged = "Flanged";
      else if (/radial/i.test(n)) s.flanged = "Radial";
      break;
    }
    case "wheels": {
      const d = m(/^(1 5\/8|[\d.]+)"/);
      if (d) s.diameter = `${d[1]}"`;
      const types: [RegExp, string][] = [
        [/stealth/i, "Stealth"],
        [/compliant/i, "Compliant"],
        [/colson/i, "Colson"],
        [/mecanum/i, "Mecanum"],
        [/omni/i, "Omni"],
        [/star/i, "Star"],
        [/flex/i, "Flex"],
        [/sushi/i, "Sushi"],
        [/pneumatic/i, "Pneumatic"],
        [/silicone tubing/i, "Silicone tubing"],
        [/tread/i, "Tread"],
        [/flywheel/i, "Flywheel"],
        [/smoothgrip|drive wheel/i, "Traction"],
      ];
      const type = types.find(([re]) => re.test(n));
      if (type) s.type = type[1];
      const w = m(/([\d.\/]+") wide/) ?? m(/^[\d.]+" × ([\d.\/]+")/);
      if (w) s.width = w[1];
      const c = m(/– ([a-z ]+?)(?:,| \(|$)/i) ?? m(/, (light gray|green)\b/);
      if (c) s.color = c[1];
      if (/1\/2" Hex/.test(n)) s.bore = '1/2" Hex';
      break;
    }
    case "round-tubes": {
      const t = m(/Ø(\d+(?:\.\d+)?)(?:×(\d+(?:\.\d+)?))?mm/);
      if (t) {
        s.od = t[1];
        if (t[2]) {
          s.wall = t[2];
          s.material = `(${t[1]}*${t[2]})mm`;
        }
      }
      if (unit === "Meters") s.length = "1000";
      break;
    }
    case "square-tubes": {
      const t = m(/(\d+)×(\d+)(?:×(\d+(?:\.\d+)?))?mm/);
      if (t) {
        s.size = `${t[1]}×${t[2]}`;
        if (t[3]) {
          s.wall = t[3];
          s.material = `(${t[1]}*${t[2]}*${t[3]})mm`;
        }
      }
      if (unit === "Meters") s.length = "1000";
      break;
    }
    case "wood-composites": {
      const t = m(/SRPP sheet ([\d/]+)"/);
      if (t)
        s.thickness = t[1] === "1/4" ? "6.35" : t[1] === "3/16" ? "4.76" : "";
      break;
    }
    case "wiring": {
      const g = m(/(\d+) AWG/);
      if (g) s.gauge = g[1];
      const kinds: [RegExp, string][] = [
        [/ferrule/i, "Ferrule"],
        [/ring terminal/i, "Ring terminal"],
        [/lug/i, "Lug"],
        [/housing/i, "Housing"],
        [/contact/i, "Contact"],
        [/resistor/i, "Resistor"],
        [/loom|heat shrink/i, "Loom"],
        [/connector|boots|SB120/i, "Connector"],
        [/ethernet cable|poe cable|3-core|cable kit|cable making/i, "Cable"],
        [/wire/i, "Wire"],
      ];
      const k = kinds.find(([re]) => re.test(n));
      if (k) s.kind = k[1];
      if (unit) s.unit = unit;
      break;
    }
    case "shop-supplies": {
      const d = m(/rope (\d+mm)/) ?? m(/(\d+(?:\.\d+)?×\d+mm)/);
      if (d) s.size = d[1];
      if (unit) s.unit = unit;
      break;
    }
    case "hand-tools": {
      const z = m(
        /\b(?:key|wrench|socket|caliper|measure)\s+(\d+(?:\.\d+)?(?:mm|m)|\d+\/\d+")/i,
      );
      if (z) s.size = z[1];
      break;
    }
    case "pinions-adapters": {
      const t = m(/(\d+)T\b/);
      if (t) s.teeth = t[1];
      const dp = m(/(10|20|32)DP/);
      if (dp) s.dp = `${dp[1]} DP`;
      else if (/^GT2/.test(n)) s.dp = "GT2 3mm";
      else if (/^HTD/.test(n)) s.dp = "HTD 5mm";
      s.kind = /pulley/i.test(n)
        ? "Pulley"
        : /adapter|connect/i.test(n)
          ? "Adapter"
          : "Pinion";
      const sp: [RegExp, string][] = [
        [/splinexs/i, "SplineXS"],
        [/falcon/i, "Falcon"],
        [/kraken/i, "Kraken"],
        [/rs775|775/i, "RS775"],
        [/^3\/8" to/i, '3/8" Hex'],
        [/^1\/2" Hex/i, '1/2" Hex'],
      ];
      const hit = sp.find(([re]) => re.test(n));
      if (hit) s.spline = hit[1];
      break;
    }
    case "gearboxes": {
      if (/maxplanetary/i.test(n)) s.type = "MAXPlanetary";
      else if (/versaplanetary/i.test(n)) s.type = "VersaPlanetary";
      else if (/cycloid/i.test(n)) s.type = "Cycloidal";
      const r = m(/(\d+:\d+)/);
      if (r) s.ratio = r[1];
      break;
    }
  }
  return s;
}

// Note parts that only said how stock is counted, or a size the specs now hold.
function cleanNote(note: string, specs: Specs): string | null {
  const kept = note
    .split(/;\s*/)
    .map((x) => x.trim())
    .filter(
      (x) =>
        x &&
        !UNITS[x] &&
        !(specs.size && /^(גודל )?50\/9[01]$|^1\.2\*2\.4$/.test(x)) &&
        !(specs.length && /^אורך \d+ ס״מ$/.test(x)),
    );
  return kept.join("; ") || null;
}

// Sprocket names lose the bore, thickness and store in brackets once those are specs.
function cleanName(cat: string, name: string, specs: Specs): string {
  if (cat !== "sprockets") return name;
  const hex = specs.bore ? ` ${specs.bore}` : "";
  return name.replace(/^(#\d+ \d+T) Sprocket \(.*\)$/, `$1${hex} Sprocket`);
}

// Only values a field accepts: a choice from its list, a number for a number field.
function fits(field: CategoryField, value: string) {
  const choices = fieldChoices(field);
  if (choices.length) return choices.includes(value);
  if (field.kind === "number") return /^\d+(\.\d+)?$/.test(value);
  return !!value;
}

export async function backfillSpecs(dry: boolean) {
  const live = await listCategories();
  const cats: InvCategory[] = live.map((c) => ({
    ...c,
    fields: mergeFields(c.id, c.fields),
  }));
  const fieldChanges = cats
    .filter((c, i) => shape(c.fields) !== shape(live[i].fields))
    .map((c) => c.id);
  const items = await db.select().from(inventoryItems);
  const changes: { item: Item; values: Partial<Item> }[] = [];
  for (const item of items) {
    const cat = cats.find((c) => c.id === item.category);
    if (!cat) continue;
    const renamed = RENAMED[cat.id] ?? {};
    const specs: Specs = {};
    for (const [k, v] of Object.entries(item.specs)) specs[renamed[k] ?? k] = v;
    const found = readItem(cat.id, item.name, item.note ?? "");
    for (const [k, v] of Object.entries(found)) {
      const field = cat.fields.find((f) => f.id === k);
      if (field && !specs[k] && v && fits(field, v)) specs[k] = v;
    }
    const note = item.note ? cleanNote(item.note, specs) : null;
    const name = cleanName(cat.id, item.name, specs);
    const values: Partial<Item> = {
      ...(JSON.stringify(specs) !== JSON.stringify(item.specs) && { specs }),
      ...(note !== item.note && { note }),
      ...(name !== item.name && { name }),
    };
    if (Object.keys(values).length) changes.push({ item, values });
  }
  if (dry)
    return {
      fieldChanges: Object.fromEntries(
        cats
          .filter((c) => fieldChanges.includes(c.id))
          .map((c) => [c.id, c.fields.map((f) => f.id)]),
      ),
      items: changes.length,
      sample: changes.map(({ item, values }) =>
        [
          values.name ? `${item.name} → ${values.name}` : item.name,
          values.specs &&
            Object.entries(values.specs)
              .filter(([k, v]) => item.specs[k] !== v)
              .map(([k, v]) => `+${k}=${v}`)
              .join(" "),
          "note" in values ? `note: ${item.note} → ${values.note ?? "∅"}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      ),
    };

  await db.transaction(async (tx) => {
    const [had] = await tx
      .select()
      .from(onshapeCache)
      .where(eq(onshapeCache.key, BACKUP));
    if (!had)
      await tx.insert(onshapeCache).values({
        key: BACKUP,
        payload: {
          categories: live.map((c) => ({ id: c.id, fields: c.fields })),
          items: changes.map(({ item }) => ({
            id: item.id,
            name: item.name,
            specs: item.specs,
            note: item.note,
          })),
        },
      });
    for (const c of cats.filter((c) => fieldChanges.includes(c.id)))
      await tx
        .update(inventoryCategories)
        .set({ fields: c.fields })
        .where(eq(inventoryCategories.id, c.id));
    for (const { item, values } of changes) {
      await tx
        .update(inventoryItems)
        .set(values)
        .where(eq(inventoryItems.id, item.id));
      await recordItemChanges(tx, item.id, item, values, ctx);
    }
  });
  return { categoriesUpdated: fieldChanges, itemsUpdated: changes.length };
}
