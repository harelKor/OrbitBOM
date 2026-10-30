-- Base materials reach the inventory (Harel, 2026-10-30): material fields offer the Settings list
-- (Aluminum, 6061-T6, Carbon Fiber...) instead of the old FRCBOM shape names, carbon tubes join
-- Round tubes as "<Material> <OD>x<Wall> tube", and billet blocks and standoff stock move to a new
-- Cylinders & blocks category. Everything touched is backed up first (onshape_cache
-- "inventory-seed:tubes-blocks-backup-2026-10-30"), and each item change gets a history line.
INSERT INTO "onshape_cache" ("key", "payload")
SELECT 'inventory-seed:tubes-blocks-backup-2026-10-30', jsonb_build_object(
  'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM "inventory_categories" c), '[]'::jsonb),
  'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i."id", 'name', i."name", 'category', i."category", 'specs', i."specs"))
    FROM "inventory_items" i WHERE i."category" IN ('round-tubes', 'carbon-tubes', 'square-tubes', 'aluminum-plates', 'shafts')), '[]'::jsonb),
  'parts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p."id", 'material', p."material", 'cotsCategory', p."cots_category"))
    FROM "parts" p WHERE p."cots_category" = 'carbon-tubes' OR p."inventory_item_id" IN (SELECT "id" FROM "inventory_items" WHERE "category" IN ('round-tubes', 'carbon-tubes', 'shafts'))), '[]'::jsonb)
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Material fields: no more FRCBOM groups. Plates offer three, filament five, the rest all.
UPDATE "inventory_categories" c SET "fields" = (
  SELECT jsonb_agg(
    CASE WHEN f->>'kind' = 'material' THEN (f - 'materials' - 'options') || CASE c."id"
      WHEN 'aluminum-plates' THEN '{"options": ["Aluminum", "6061-T6", "7075-T6"]}'::jsonb
      WHEN 'filament' THEN '{"options": ["PLA", "PETG", "TPU", "Onyx", "PA612"]}'::jsonb
      ELSE '{}'::jsonb END
    ELSE f END ORDER BY n)
  FROM jsonb_array_elements(c."fields") WITH ORDINALITY AS e(f, n)
) WHERE c."fields" @> '[{"kind": "material"}]'::jsonb;--> statement-breakpoint
UPDATE "inventory_categories" SET "fields" = $j$[{"id": "material", "label": "Material", "kind": "material"}, {"id": "od", "label": "OD (mm)", "kind": "number"}, {"id": "wall", "label": "Wall (mm)", "kind": "text"}, {"id": "length", "label": "Length (mm)", "kind": "number", "name": "{}mm"}]$j$::jsonb WHERE "id" = 'round-tubes';--> statement-breakpoint

-- Cylinders & blocks, right after the last Raw Stock category.
UPDATE "inventory_categories" SET "position" = "position" + 1
WHERE "position" > (SELECT max("position") FROM "inventory_categories" WHERE "group" = 'consumables')
  AND NOT EXISTS (SELECT 1 FROM "inventory_categories" WHERE "id" = 'cylinders-blocks');--> statement-breakpoint
INSERT INTO "inventory_categories" ("id", "label", "noun", "position", "group", "sheet", "fields")
SELECT 'cylinders-blocks', 'Cylinders & blocks', '', (SELECT coalesce(max("position") + 1, 0) FROM "inventory_categories" WHERE "group" = 'consumables'), 'consumables', true,
  $j$[{"id": "shape", "label": "Shape", "kind": "options", "options": ["Cylinder", "Block"]}, {"id": "material", "label": "Material", "kind": "material"}, {"id": "od", "label": "OD (mm)", "kind": "number", "name": "Ø{}mm", "when": "Cylinder"}, {"id": "length", "label": "Length (mm)", "kind": "number", "name": "{}mm", "when": "Cylinder"}, {"id": "x", "label": "X (mm)", "kind": "number", "when": "Block"}, {"id": "y", "label": "Y (mm)", "kind": "number", "when": "Block"}, {"id": "z", "label": "Z (mm)", "kind": "number", "when": "Block"}]$j$::jsonb
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- The new category, specs and name of every item that changes.
CREATE TEMP TABLE "item_fix" AS
WITH src AS (
  SELECT i."id", i."name", i."category", i."specs",
    regexp_replace(coalesce(i."specs"->>'od', ''), '\s*mm\s*$', '', 'i') AS od,
    regexp_replace(coalesce(i."specs"->>'wall', ''), '\s*mm\s*$', '', 'i') AS wall,
    regexp_replace(coalesce(i."specs"->>'length', ''), '\s*mm\s*$', '', 'i') AS len
  FROM "inventory_items" i
  WHERE i."category" IN ('carbon-tubes', 'round-tubes', 'aluminum-plates', 'square-tubes')
     OR (i."category" = 'shafts' AND i."name" ~* '^(aluminum|brass|steel) block$|standoff stock')
), fixed AS (
  SELECT s.*,
    CASE
      WHEN s."category" = 'carbon-tubes' AND s."specs"->>'shape' = 'Square' THEN 'square-tubes'
      WHEN s."category" = 'carbon-tubes' THEN 'round-tubes'
      WHEN s."category" = 'shafts' THEN 'cylinders-blocks'
      ELSE s."category"
    END AS new_category,
    CASE
      -- Carbon box tubes go to Box tubes: size "22×22", wall, length, Carbon Fiber.
      WHEN s."category" = 'carbon-tubes' AND s."specs"->>'shape' = 'Square' THEN jsonb_strip_nulls(jsonb_build_object(
        'material', 'Carbon Fiber', 'size', nullif(s.od, ''), 'wall', nullif(s.wall, ''), 'length', nullif(s.len, '')))
      WHEN s."category" = 'carbon-tubes' THEN jsonb_strip_nulls(jsonb_build_object(
        'material', 'Carbon Fiber', 'od', nullif(s.od, ''), 'wall', nullif(s.wall, ''), 'length', nullif(s.len, '')))
      -- Polycarbonate tubes in inches: OD and wall in mm from (OD*ID)IN.
      WHEN s."category" = 'round-tubes' AND s."specs"->>'material' = '(1.25*1.125)IN' THEN s."specs" || '{"material": "Polycarbonate", "od": "31.75", "wall": "1.59"}'::jsonb
      WHEN s."category" = 'round-tubes' AND s."specs"->>'material' = '(1.5*1.375)IN' THEN s."specs" || '{"material": "Polycarbonate", "od": "38.1", "wall": "1.59"}'::jsonb
      WHEN s."category" = 'round-tubes' THEN s."specs" || jsonb_build_object('material',
        CASE WHEN s."name" ~* 'polycarb|lexan' THEN 'Polycarbonate' WHEN s."name" ~* 'carbon' THEN 'Carbon Fiber' WHEN s."name" ~* 'steel' THEN 'Steel'
          WHEN s."specs"->>'material' IS NULL OR s."specs"->>'material' ~ '^\(' THEN 'Aluminum' ELSE s."specs"->>'material' END)
      WHEN s."category" = 'aluminum-plates' AND s."specs"->>'material' ~* '^\d+(\.\d+)?mm 6061-T6$' THEN s."specs" || '{"material": "6061-T6"}'::jsonb
      WHEN s."category" = 'square-tubes' AND s."specs"->>'material' ~ '^\(.*\)mm$' THEN s."specs" || '{"material": "Aluminum"}'::jsonb
      WHEN s."category" = 'shafts' AND s."name" ~* 'block$' THEN jsonb_build_object('shape', 'Block', 'material', initcap(split_part(s."name", ' ', 1)))
      WHEN s."category" = 'shafts' THEN jsonb_build_object('shape', 'Cylinder', 'material', 'Aluminum', 'od', substring(s."name" from '^(\d+(?:\.\d+)?)\s*mm'))
      ELSE s."specs"
    END AS new_specs
  FROM src s
)
SELECT f."id", f."name" AS old_name, f."category" AS old_category, f."specs" AS old_specs, f.new_category, f.new_specs,
  CASE
    -- Round tubes are named "<Material> <OD>x<Wall> tube" ("Ø<OD>" with no wall).
    WHEN f.new_category = 'round-tubes' AND coalesce(f.new_specs->>'od', '') <> '' THEN
      concat_ws(' ', f.new_specs->>'material',
        CASE WHEN coalesce(f.new_specs->>'wall', '') <> '' THEN (f.new_specs->>'od') || 'x' || (f.new_specs->>'wall') ELSE 'Ø' || (f.new_specs->>'od') END,
        'tube') || CASE WHEN f."name" ~* 'other walls' THEN ' (other walls)' ELSE '' END
    ELSE f."name"
  END AS new_name
FROM fixed f;--> statement-breakpoint

INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'name', to_jsonb(old_name), to_jsonb(new_name), 'sync' FROM "item_fix" WHERE new_name <> old_name;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'category', to_jsonb(old_category), to_jsonb(new_category), 'sync' FROM "item_fix" WHERE new_category <> old_category;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', old_specs, new_specs, 'sync' FROM "item_fix" WHERE new_specs <> old_specs;--> statement-breakpoint
UPDATE "inventory_items" i SET "name" = f.new_name, "category" = f.new_category, "specs" = f.new_specs
FROM "item_fix" f WHERE i."id" = f."id" AND (f.new_name <> f.old_name OR f.new_category <> f.old_category OR f.new_specs <> f.old_specs);--> statement-breakpoint

-- A BOM part's material is its item's name, so renamed items carry it along.
UPDATE "parts" p SET "material" = f.new_name
FROM "item_fix" f WHERE p."inventory_item_id" = f."id" AND p."material" = f.old_name AND f.new_name <> f.old_name;--> statement-breakpoint
UPDATE "parts" SET "cots_category" = 'round-tubes' WHERE "cots_category" = 'carbon-tubes';--> statement-breakpoint
DROP TABLE "item_fix";--> statement-breakpoint

DELETE FROM "inventory_categories" WHERE "id" = 'carbon-tubes' AND NOT EXISTS (SELECT 1 FROM "inventory_items" WHERE "category" = 'carbon-tubes');
