-- Box tubes without "Aluminum" at the start of the name (Harel, 2026-11-01): every box tube is
-- aluminium, so "Aluminum box tube 25×50×1.5mm" becomes "Box tube 25×50×1.5mm". The Hebrew
-- "פרופיל אלומיניום" prefix goes the same way. A name that would clash with another box tube is
-- left alone. Items keep the old name as an alias (for auto-link), linked BOM parts' material
-- follows the new name, and each rename gets a history line. Backed up first in onshape_cache
-- "inventory-seed:box-tube-names-backup-2026-11-01". Running it again changes nothing.
INSERT INTO "onshape_cache" ("key", "payload")
SELECT 'inventory-seed:box-tube-names-backup-2026-11-01', jsonb_build_object(
  'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i."id", 'name', i."name", 'aliases', to_jsonb(i."aliases")))
    FROM "inventory_items" i WHERE i."category" = 'square-tubes'), '[]'::jsonb),
  'parts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p."id", 'material', p."material", 'inventoryItemId', p."inventory_item_id"))
    FROM "parts" p JOIN "inventory_items" i ON i."id" = p."inventory_item_id" WHERE i."category" = 'square-tubes'), '[]'::jsonb)
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE TEMP TABLE "box_tube_fix" AS
WITH stripped AS (
  SELECT i."id", i."name" AS old_name,
    btrim(regexp_replace(i."name", '^\s*(alumin?i?um|פרופיל\s+אלומיניום|אלומיניום)\s+', '', 'i')) AS bare
  FROM "inventory_items" i
  WHERE i."category" = 'square-tubes'
    AND i."name" ~* '^\s*(alumin?i?um|פרופיל\s+אלומיניום|אלומיניום)\s+\S'
)
-- "פרופיל אלומיניום 20x20" has no noun left, so it gets " Box tube".
SELECT s."id", s.old_name,
  upper(left(s.bare, 1)) || substring(s.bare from 2) || CASE WHEN s.bare ~* '(tube|צינור|פרופיל)' THEN '' ELSE ' Box tube' END AS new_name
FROM stripped s;--> statement-breakpoint
-- No clashes: with another box tube's name, or between two renames.
DELETE FROM "box_tube_fix" f
WHERE EXISTS (SELECT 1 FROM "inventory_items" i WHERE i."category" = 'square-tubes' AND i."id" <> f."id" AND lower(i."name") = lower(f.new_name))
   OR (SELECT count(*) FROM "box_tube_fix" g WHERE lower(g.new_name) = lower(f.new_name)) > 1;--> statement-breakpoint

INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'name', to_jsonb(old_name), to_jsonb(new_name), 'sync' FROM "box_tube_fix";--> statement-breakpoint
UPDATE "inventory_items" i
SET "name" = f.new_name,
    "aliases" = CASE WHEN f.old_name = ANY(i."aliases") THEN i."aliases" ELSE array_append(i."aliases", f.old_name) END
FROM "box_tube_fix" f WHERE i."id" = f."id";--> statement-breakpoint
UPDATE "parts" p SET "material" = f.new_name
FROM "box_tube_fix" f WHERE p."inventory_item_id" = f."id" AND p."material" = f.old_name;--> statement-breakpoint
DROP TABLE "box_tube_fix";
