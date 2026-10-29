-- The add box dropped a bearing's ID when it wasn't one of the listed bores (Harel, 2026-10-29):
-- "11x18x7" was saved as "18 OD 7 thick Bearing" with no ID. It gets its ID and its name back,
-- only if it still has the values it was saved with, with a line in its history.
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'name', to_jsonb("name"), to_jsonb('11x18x7 Bearing'::text), 'sync' FROM "inventory_items"
WHERE "id" = '4ccd0d80-4f1d-458c-b8bd-091ef84ae11d' AND "name" = '18 OD 7 thick Bearing' AND "specs" = '{"od": "18", "width": "7"}'::jsonb;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', "specs", '{"bore": "11", "od": "18", "width": "7"}'::jsonb, 'sync' FROM "inventory_items"
WHERE "id" = '4ccd0d80-4f1d-458c-b8bd-091ef84ae11d' AND "name" = '18 OD 7 thick Bearing' AND "specs" = '{"od": "18", "width": "7"}'::jsonb;--> statement-breakpoint
UPDATE "inventory_items" SET "name" = '11x18x7 Bearing', "specs" = '{"bore": "11", "od": "18", "width": "7"}'::jsonb
WHERE "id" = '4ccd0d80-4f1d-458c-b8bd-091ef84ae11d' AND "name" = '18 OD 7 thick Bearing' AND "specs" = '{"od": "18", "width": "7"}'::jsonb;
