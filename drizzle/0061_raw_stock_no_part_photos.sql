-- Raw Stock items never wear a BOM part's CAD thumbnail (Harel, 2026-10-31): a Raw Stock item
-- (a Raw Stock category, or one counted in sheets) whose photo is a part thumbnail's R2 key loses
-- it, so it shows its category's picture again. Each cleared photo gets a history line.
CREATE TEMP TABLE "raw_photo_fix" AS
SELECT i."id", i."image_path" FROM "inventory_items" i
JOIN "inventory_categories" c ON c."id" = i."category"
WHERE (c."group" = 'consumables' OR c."sheet")
  AND (i."image_path" LIKE 'thumbs/%' OR i."image_path" LIKE 'thumbnails/%');--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'imagePath', to_jsonb("image_path"), 'null'::jsonb, 'sync' FROM "raw_photo_fix";--> statement-breakpoint
UPDATE "inventory_items" SET "image_path" = NULL WHERE "id" IN (SELECT "id" FROM "raw_photo_fix");--> statement-breakpoint
DROP TABLE "raw_photo_fix";
