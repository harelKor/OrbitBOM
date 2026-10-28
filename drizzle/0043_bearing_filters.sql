-- Bearings filter as Bore (ID) -> OD -> Width -> Type (Harel, 2026-10-28). The bearings' rows are
-- backed up first (onshape_cache "inventory-seed:bearings-backup-2026-10-28"); the category takes
-- config/inventory.ts's fields (each bore once, "Flanged" reads Type) and four bearings get the
-- specs their names give (the old hidden "id" becomes the bore). Each item changes only if its
-- specs are still the ones read on 2026-10-28, with a line in its history.
INSERT INTO "onshape_cache" ("key", "payload")
SELECT 'inventory-seed:bearings-backup-2026-10-28', jsonb_build_object(
  'category', (SELECT to_jsonb(c) FROM "inventory_categories" c WHERE c."id" = 'bearings'),
  'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i."id", 'specs', i."specs")) FROM "inventory_items" i WHERE i."category" = 'bearings'), '[]'::jsonb)
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "inventory_categories" SET "fields" = $j$[{"id": "bore", "label": "Bore (ID)", "kind": "options", "options": ["1/2\" Hex", "3/8\" Hex", "1/2\" ThunderHex", "3/8\" ThunderHex", "1/2\" Round", "3/8\" Round", "1/4\" Round", "3/4\" Round", "0.6\" Round", "4mm", "5mm", "6mm", "6.35mm", "8mm", "9mm", "9.5mm", "10mm", "12mm", "15mm", "17mm", "20mm", "25mm", "30mm"]}, {"id": "od", "label": "OD", "kind": "text", "name": "{} OD"}, {"id": "width", "label": "Width", "kind": "text", "name": "{} wide"}, {"id": "flanged", "label": "Type", "kind": "options", "options": ["Flanged", "Radial"]}]$j$::jsonb WHERE "id" = 'bearings';--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', "specs", $j${"bore": "3/8\" ThunderHex", "od": "0.875\"", "flanged": "Flanged"}$j$::jsonb, 'sync' FROM "inventory_items" WHERE "id" = 'd10127fc-d622-4ef9-9e8c-6f7e605dda6c' AND "specs" = $j${"id": "10.25mm", "od": "0.875\"", "flanged": "Flanged"}$j$::jsonb;--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = $j${"bore": "3/8\" ThunderHex", "od": "0.875\"", "flanged": "Flanged"}$j$::jsonb WHERE "id" = 'd10127fc-d622-4ef9-9e8c-6f7e605dda6c' AND "specs" = $j${"id": "10.25mm", "od": "0.875\"", "flanged": "Flanged"}$j$::jsonb;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', "specs", $j${"bore": "0.6\" Round", "od": "1.2\"", "width": "0.2\""}$j$::jsonb, 'sync' FROM "inventory_items" WHERE "id" = 'b01846b2-160c-460d-8858-2f12d2500a60' AND "specs" = $j${"id": "0.6\"", "od": "1.2\"", "width": "0.2\""}$j$::jsonb;--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = $j${"bore": "0.6\" Round", "od": "1.2\"", "width": "0.2\""}$j$::jsonb WHERE "id" = 'b01846b2-160c-460d-8858-2f12d2500a60' AND "specs" = $j${"id": "0.6\"", "od": "1.2\"", "width": "0.2\""}$j$::jsonb;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', "specs", $j${"od": "16mm", "bore": "10mm", "width": "5mm", "flanged": "Radial"}$j$::jsonb, 'sync' FROM "inventory_items" WHERE "id" = '35dd8b98-caae-43ee-b916-a62b8f6bb202' AND "specs" = $j${"od": "16mm", "bore": "10mm", "width": "5mm"}$j$::jsonb;--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = $j${"od": "16mm", "bore": "10mm", "width": "5mm", "flanged": "Radial"}$j$::jsonb WHERE "id" = '35dd8b98-caae-43ee-b916-a62b8f6bb202' AND "specs" = $j${"od": "16mm", "bore": "10mm", "width": "5mm"}$j$::jsonb;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'specs', "specs", $j${"bore": "3/4\" Round", "od": "1 3/8\"", "width": "0.43\""}$j$::jsonb, 'sync' FROM "inventory_items" WHERE "id" = '204aae4c-b6d7-4ac1-819f-ba293407d4f9' AND "specs" = $j${}$j$::jsonb;--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = $j${"bore": "3/4\" Round", "od": "1 3/8\"", "width": "0.43\""}$j$::jsonb WHERE "id" = '204aae4c-b6d7-4ac1-819f-ba293407d4f9' AND "specs" = $j${}$j$::jsonb;
