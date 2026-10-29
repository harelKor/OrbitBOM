import "server-only";
import { eq } from "drizzle-orm";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { db, schema } from "@/db";
import type { CategoryField } from "@/db/schema";
import { bearingSize } from "./categories";
import { recordItemChanges } from "./history";
import { specKey } from "./specFilters";

// One-off (Harel, 2026-10-28): Bearings filter as Bore (ID) → OD → Width → Type. The category
// takes config/inventory.ts's bearing fields (bores once each, "Flanged" now reads Type), and each
// bearing gets clean bore / od / width / flanged values, read from its name where they're missing
// ("Bearing 8×16×5mm flanged"); the old hidden "id" value becomes the bore. Runs from
// /api/cron/inventory-seed (?step=bearings&dry=1, then ?step=bearings). Safe to run again.
// 2026-10-29: metric values are bare millimetres ("8", not "8mm") and bearings with all three
// sizes are named ID x OD x Thick: "Bearing 8×16×5mm flanged" → "8x16x5 Flanged Bearing".

const { inventoryItems, inventoryCategories, onshapeCache } = schema;
const BACKUP = "inventory-seed:bearings-backup-2026-10-29";
const ctx = { memberId: null, via: "sync" as const };

type Specs = Record<string, string>;

const seed = DEFAULT_CATEGORIES.find((c) => c.id === "bearings")!;
const BORES = seed.fields.find((f) => f.id === "bore")!.options ?? [];
const INCH_BORES = BORES.filter((b) => b.includes('"'));

const tidy = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const mm = (v: string) => v.replace(/^(\d+(?:\.\d+)?)\s*mm$/i, "$1");
const optionOf = (v: string) => BORES.find((b) => specKey(b) === specKey(v));

export function cleanBearing(name: string, specs: Specs): Specs {
  const out: Specs = {};
  for (const [k, v] of Object.entries(specs)) if (tidy(v)) out[k] = tidy(v);

  // "Bearing 8×16×5mm", "8x16x5 Bearing", "Bearing 3/4" × 1 3/8" × 0.43" (odd)"
  const inch = name.match(/(\d+(?:[./]\d+)?)"\s*[×x]\s*(\d+(?:\s\d+\/\d+|[./]\d+)?)"\s*[×x]\s*(\d+(?:[./]\d+)?)"/i);
  const metric = inch ? null : name.match(/(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)(?![\d."])/i);
  if (metric) {
    out.bore ||= metric[1];
    out.od ||= metric[2];
    out.width ||= metric[3];
  } else if (inch) {
    out.bore ||= `${inch[1]}" Round`;
    out.od ||= `${inch[2]}"`;
    out.width ||= `${inch[3]}"`;
  }
  // A hex or round bore named in the name ("3/8" ThunderHex Flanged Bearing").
  if (!out.bore) {
    const named = [...INCH_BORES].sort((a, b) => b.length - a.length).find((b) => name.toLowerCase().includes(b.toLowerCase()));
    if (named) out.bore = named;
    else if (out.id) out.bore = /"$/.test(out.id) ? `${out.id} Round` : out.id;
  }
  if (out.bore) delete out.id;

  if (out.bore) out.bore = optionOf(out.bore) ?? mm(out.bore);
  if (out.od) out.od = mm(out.od);
  if (out.width) out.width = mm(out.width);
  if (!out.flanged) {
    if (/flange/i.test(name)) out.flanged = "Flanged";
    else if (/radial/i.test(name) || metric) out.flanged = "Radial";
  }
  return out;
}

// The name for a bearing with all three sizes: "8x16x5 Flanged Bearing", keeping a trailing note
// like "(odd)". Other names stay.
export function bearingName(name: string, specs: Specs): string {
  const size = bearingSize(specs);
  if (!size || !/\d\s*"?\s*[×x*]/i.test(name)) return name;
  const note = name.match(/\s*\((?!radial)[^)]*\)\s*$/i)?.[0].trim();
  return [size, specs.flanged === "Flanged" ? "Flanged" : "", "Bearing", note].filter(Boolean).join(" ");
}

export async function cleanBearings(dry: boolean) {
  const [live] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, "bearings"));
  if (!live) return { error: "No Bearings category." };
  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.category, "bearings"));
  const changed = items
    .map((item) => {
      const specs = cleanBearing(item.name, item.specs);
      return { item, specs, name: bearingName(item.name, specs) };
    })
    .filter((c) => c.name !== c.item.name || JSON.stringify(c.specs) !== JSON.stringify(c.item.specs));

  // The config's fields; a field the config doesn't have stays, hidden, while an item holds it.
  const ids = new Set(seed.fields.map((f) => f.id));
  const after = new Map(items.map((i) => [i.id, i.specs]));
  for (const c of changed) after.set(c.item.id, c.specs);
  const held = new Set([...after.values()].flatMap((s) => Object.keys(s)));
  const fields: CategoryField[] = [
    ...seed.fields,
    ...live.fields.filter((f) => !ids.has(f.id) && held.has(f.id)).map((f) => ({ ...f, hidden: true })),
  ];

  const preview = {
    fields: fields.map((f) => `${f.label}${f.hidden ? " (hidden)" : ""}`),
    items: changed.map((c) => ({ name: c.item.name, renamed: c.name, before: c.item.specs, after: c.specs })),
    untouched: items.length - changed.length,
  };
  if (dry) return { dry: true, ...preview };

  await db.transaction(async (tx) => {
    const [had] = await tx.select().from(onshapeCache).where(eq(onshapeCache.key, BACKUP));
    if (!had)
      await tx.insert(onshapeCache).values({
        key: BACKUP,
        payload: { category: live, items: changed.map((c) => ({ id: c.item.id, name: c.item.name, specs: c.item.specs })) },
      });
    await tx.update(inventoryCategories).set({ fields }).where(eq(inventoryCategories.id, "bearings"));
    for (const c of changed) {
      await tx.update(inventoryItems).set({ name: c.name, specs: c.specs }).where(eq(inventoryItems.id, c.item.id));
      await recordItemChanges(tx, c.item.id, c.item, { name: c.name, specs: c.specs }, ctx);
    }
  });
  return { itemsChanged: changed.length, ...preview };
}
