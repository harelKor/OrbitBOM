-- PLA parts are printed on the Bambu (Harel, 2026-10-31): parts whose material, or Onshape's own
-- material, says PLA and that have no first process yet (or the old "3D Print", which is no
-- machine) get process1 "3d-bambu" ("3D Print - Bambu") and become In-House. One with no
-- inventory material is linked to the PLA filament item when inventory has one (and keeps it on
-- later syncs). COTS and External parts are left alone. Every change gets a history line under
-- one batch (e692555a-0dd3-42a6-bb95-208266f1bfc6).
CREATE TEMP TABLE "pla_item" AS
SELECT i."id", i."name" FROM "inventory_items" i
WHERE i."category" = 'filament' AND (lower(trim(i."name")) = 'pla' OR lower(i."specs"->>'material') = 'pla' OR i."name" ~* '\mpla\M')
ORDER BY (lower(trim(i."name")) = 'pla') DESC, (lower(i."specs"->>'material') = 'pla') DESC, i."name"
LIMIT 1;--> statement-breakpoint
CREATE TEMP TABLE "pla_fix" AS
SELECT p."id", p."classification"::text AS old_class, p."process1" AS old_p1, p."material" AS old_material, p."inventory_item_id" AS old_item,
  CASE WHEN p."inventory_item_id" IS NULL AND (SELECT "id" FROM "pla_item") IS NOT NULL THEN (SELECT "name" FROM "pla_item") ELSE p."material" END AS new_material,
  CASE WHEN p."inventory_item_id" IS NULL THEN (SELECT "id" FROM "pla_item") ELSE p."inventory_item_id" END AS new_item
FROM "parts" p
WHERE (p."material" ~* '\mpla\M' OR p."geometry"->>'onshapeMaterial' ~* '\mpla\M')
  AND (p."process1" IS NULL OR p."process1" = '3D Print')
  AND p."classification"::text IN ('inhouse', 'undefined');--> statement-breakpoint
INSERT INTO "part_history" ("part_id", "field", "old_value", "new_value", "via", "batch_id")
SELECT "id", 'process1', to_jsonb(old_p1), '"3d-bambu"'::jsonb, 'sync'::change_via, 'e692555a-0dd3-42a6-bb95-208266f1bfc6'::uuid FROM "pla_fix"
UNION ALL
SELECT "id", 'classification', to_jsonb(old_class), '"inhouse"'::jsonb, 'sync'::change_via, 'e692555a-0dd3-42a6-bb95-208266f1bfc6'::uuid FROM "pla_fix" WHERE old_class <> 'inhouse'
UNION ALL
SELECT "id", 'material', to_jsonb(old_material), to_jsonb(new_material), 'sync'::change_via, 'e692555a-0dd3-42a6-bb95-208266f1bfc6'::uuid FROM "pla_fix" WHERE new_material IS DISTINCT FROM old_material
UNION ALL
SELECT "id", 'inventoryItemId', to_jsonb(old_item), to_jsonb(new_item), 'sync'::change_via, 'e692555a-0dd3-42a6-bb95-208266f1bfc6'::uuid FROM "pla_fix" WHERE new_item IS DISTINCT FROM old_item;--> statement-breakpoint
UPDATE "parts" p SET "process1" = '3d-bambu', "classification" = 'inhouse', "material" = f.new_material, "inventory_item_id" = f.new_item,
  "overridden_fields" = CASE WHEN f.new_material IS DISTINCT FROM f.old_material AND NOT ('material' = ANY(p."overridden_fields")) THEN array_append(p."overridden_fields", 'material') ELSE p."overridden_fields" END
FROM "pla_fix" f WHERE p."id" = f."id";
