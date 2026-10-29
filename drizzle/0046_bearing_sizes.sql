-- Bearings read ID x OD x Thick (Harel, 2026-10-29): the filters are ID / OD / Thick / Type, metric
-- sizes are bare millimetres ("8", not "8mm"), and bearings named from their sizes become
-- "8x16x5 Bearing" / "8x16x5 Flanged Bearing" (was "Bearing 8×16×5mm" / "... flanged"). The
-- bearings' rows are backed up first (onshape_cache "inventory-seed:bearings-backup-2026-10-29"),
-- and each changed name or specs gets a line in the item's history.
INSERT INTO "onshape_cache" ("key", "payload")
SELECT 'inventory-seed:bearings-backup-2026-10-29', jsonb_build_object(
  'category', (SELECT to_jsonb(c) FROM "inventory_categories" c WHERE c."id" = 'bearings'),
  'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i."id", 'name', i."name", 'specs', i."specs")) FROM "inventory_items" i WHERE i."category" = 'bearings'), '[]'::jsonb)
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "inventory_categories" SET "fields" = $j$[{"id": "bore", "label": "ID", "kind": "options", "options": ["1/2\" Hex", "3/8\" Hex", "1/2\" ThunderHex", "3/8\" ThunderHex", "1/2\" Round", "3/8\" Round", "1/4\" Round", "3/4\" Round", "0.6\" Round", "3", "4", "5", "6", "6.35", "7", "8", "9", "9.5", "10", "12", "15", "17", "20", "25", "30"]}, {"id": "od", "label": "OD", "kind": "text", "name": "{} OD"}, {"id": "width", "label": "Thick", "kind": "text", "name": "{} thick"}, {"id": "flanged", "label": "Type", "kind": "options", "options": ["Flanged", "Radial"]}]$j$::jsonb WHERE "id" = 'bearings';--> statement-breakpoint
CREATE TEMP TABLE "bearing_fix" AS
SELECT "id", "name" AS "old_name", "specs" AS "old_specs",
  CASE
    WHEN "name" ~* '^Bearing \d+(\.\d+)?\s*[×x]\s*\d+(\.\d+)?\s*[×x]\s*\d+(\.\d+)?\s*mm( flanged)?$'
      THEN regexp_replace("name", '^Bearing (\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*mm( flanged)?$', '\1x\2x\3', 'i')
        || CASE WHEN "name" ~* 'flanged$' THEN ' Flanged' ELSE '' END || ' Bearing'
    WHEN "name" = 'Bearing 0.6" × 1.2" × 0.2"' THEN '0.6"x1.2"x0.2" Bearing'
    WHEN "name" = 'Bearing 3/4" × 1 3/8" × 0.43" (odd)' THEN '3/4" x 1 3/8" x 0.43" Bearing (odd)'
    ELSE "name"
  END AS "new_name",
  "specs" || jsonb_strip_nulls(jsonb_build_object(
    'bore', CASE WHEN "specs"->>'bore' ~* '^\s*\d+(\.\d+)?\s*mm\s*$' THEN regexp_replace("specs"->>'bore', '^\s+|\s*mm\s*$', '', 'gi') END,
    'od', CASE WHEN "specs"->>'od' ~* '^\s*\d+(\.\d+)?\s*mm\s*$' THEN regexp_replace("specs"->>'od', '^\s+|\s*mm\s*$', '', 'gi') END,
    'width', CASE WHEN "specs"->>'width' ~* '^\s*\d+(\.\d+)?\s*mm\s*$' THEN regexp_replace("specs"->>'width', '^\s+|\s*mm\s*$', '', 'gi') END
  )) AS "new_specs"
FROM "inventory_items" WHERE "category" = 'bearings';--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'name', to_jsonb("old_name"), to_jsonb("new_name"), 'sync' FROM "bearing_fix" WHERE "new_name" <> "old_name";--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', "old_specs", "new_specs", 'sync' FROM "bearing_fix" WHERE "new_specs" <> "old_specs";--> statement-breakpoint
UPDATE "inventory_items" i SET "name" = f."new_name", "specs" = f."new_specs"
FROM "bearing_fix" f WHERE i."id" = f."id" AND (f."new_name" <> f."old_name" OR f."new_specs" <> f."old_specs");--> statement-breakpoint
DROP TABLE "bearing_fix";
