-- Raw stock names without lengths or sheet sizes (Harel, 2026-10-30, plan in
-- plan/raw-stock-name-cleanup.md): four shafts and one plate are renamed, double spaces go, and
-- carbon tubes kept twice (one item per 500mm and 700mm length) become one item each, its stock
-- as pieces by length measured against 700mm. Everything touched is backed up first (onshape_cache
-- "inventory-seed:raw-stock-names-backup-2026-10-30"), and each change gets a history line.
INSERT INTO "onshape_cache" ("key", "payload")
SELECT 'inventory-seed:raw-stock-names-backup-2026-10-30', jsonb_build_object(
  'items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM "inventory_items" i
    WHERE i."category" IN ('aluminum-plates', 'polycarbonate', 'wood-composites', 'square-tubes', 'round-tubes', 'shafts', 'cylinders-blocks')), '[]'::jsonb),
  'parts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p."id", 'material', p."material", 'inventoryItemId', p."inventory_item_id"))
    FROM "parts" p JOIN "inventory_items" i ON i."id" = p."inventory_item_id"
    WHERE i."category" IN ('square-tubes', 'round-tubes', 'shafts', 'aluminum-plates')), '[]'::jsonb),
  'moves', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m."id", 'itemId', m."item_id"))
    FROM "inventory_moves" m JOIN "inventory_items" i ON i."id" = m."item_id" WHERE i."category" IN ('square-tubes', 'round-tubes')), '[]'::jsonb)
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- 1. Renames.
CREATE TEMP TABLE "name_fix" AS
SELECT i."id", i."name" AS old_name,
  CASE
    WHEN i."category" = 'shafts' THEN regexp_replace(i."name", '\s*[–-]\s*\d+(\.\d+)?\s*(mm|cm|m)\s*$', '')
    WHEN i."id" = 'fc0aa173-051d-4f9e-b570-b5c111db5e09' THEN '12.7mm Aluminum plate'
    ELSE regexp_replace(i."name", '\s{2,}', ' ', 'g')
  END AS new_name
FROM "inventory_items" i
WHERE i."category" IN ('aluminum-plates', 'polycarbonate', 'wood-composites', 'square-tubes', 'round-tubes', 'shafts', 'cylinders-blocks');--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT "id", 'name', to_jsonb(old_name), to_jsonb(new_name), 'sync' FROM "name_fix" WHERE new_name <> old_name;--> statement-breakpoint
UPDATE "inventory_items" i SET "name" = f.new_name FROM "name_fix" f WHERE i."id" = f."id" AND f.new_name <> f.old_name;--> statement-breakpoint
UPDATE "parts" p SET "material" = f.new_name
FROM "name_fix" f WHERE p."inventory_item_id" = f."id" AND p."material" = f.old_name AND f.new_name <> f.old_name;--> statement-breakpoint
DROP TABLE "name_fix";--> statement-breakpoint

-- 2. Merges: tubes with the same name and category, one 500mm and one 700mm. The 700mm one stays.
CREATE TEMP TABLE "merge_pair" AS
SELECT keep."id" AS keep_id, drop."id" AS drop_id
FROM "inventory_items" keep
JOIN "inventory_items" drop ON drop."name" = keep."name" AND drop."category" = keep."category" AND drop."id" <> keep."id"
WHERE keep."category" IN ('round-tubes', 'square-tubes')
  AND keep."specs"->>'length' = '700' AND drop."specs"->>'length' = '500'
  AND (SELECT count(*) FROM "inventory_items" x WHERE x."name" = keep."name" AND x."category" = keep."category") = 2;--> statement-breakpoint

-- Each item's stock as lengths in mm: its piece rows (a preset fraction becomes its length), or,
-- with none counted, its stock as full lengths plus one piece for the rest.
CREATE TEMP TABLE "merge_rows" AS
WITH src AS (
  SELECT p.keep_id, i."id", i."in_stock", i."pieces", (i."specs"->>'length')::numeric AS len
  FROM "merge_pair" p JOIN "inventory_items" i ON i."id" IN (p.keep_id, p.drop_id)
), counted AS (
  SELECT s.keep_id,
    CASE left(r->>'size', 1)
      WHEN 'f' THEN round(s.len * substring(r->>'size' from 2)::numeric / 12)
      WHEN 'm' THEN substring(r->>'size' from 2)::numeric
    END::numeric AS mm,
    (r->>'count')::int AS cnt
  FROM src s, jsonb_array_elements(CASE WHEN jsonb_typeof(s."pieces") = 'array' THEN s."pieces" ELSE '[]'::jsonb END) r
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."pieces") = 'array' THEN s."pieces" ELSE '[]'::jsonb END) x WHERE (x->>'count')::int > 0)
), uncounted AS (
  SELECT s.keep_id, s.len AS mm, floor(s."in_stock" + 0.001)::int AS cnt FROM src s
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."pieces") = 'array' THEN s."pieces" ELSE '[]'::jsonb END) x WHERE (x->>'count')::int > 0)
  UNION ALL
  SELECT s.keep_id, round(s.len * round(((s."in_stock" - floor(s."in_stock" + 0.001)) * 12)::numeric) / 12), 1 FROM src s
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."pieces") = 'array' THEN s."pieces" ELSE '[]'::jsonb END) x WHERE (x->>'count')::int > 0)
    AND round((s."in_stock" - floor(s."in_stock" + 0.001)) * 12) > 0
)
SELECT keep_id, mm, sum(cnt)::int AS cnt FROM (SELECT * FROM counted UNION ALL SELECT * FROM uncounted) a
WHERE mm > 0 AND cnt > 0 GROUP BY keep_id, mm;--> statement-breakpoint

CREATE TEMP TABLE "merge_fix" AS
SELECT p.keep_id, p.drop_id, k."in_stock" AS old_stock, k."pieces" AS old_pieces,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('size', 'm' || r.mm::int, 'count', r.cnt) ORDER BY r.mm DESC) FROM "merge_rows" r WHERE r.keep_id = p.keep_id), '[]'::jsonb) AS new_pieces,
  COALESCE((SELECT round(sum(r.cnt * r.mm / 700), 4) FROM "merge_rows" r WHERE r.keep_id = p.keep_id), 0)::double precision AS new_stock,
  k."in_stock" + d."in_stock" AS moves_stock,
  CASE WHEN k."season_need" IS NULL AND d."season_need" IS NULL THEN NULL ELSE coalesce(k."season_need", 0) + coalesce(d."season_need", 0) END AS new_need
FROM "merge_pair" p JOIN "inventory_items" k ON k."id" = p.keep_id JOIN "inventory_items" d ON d."id" = p.drop_id;--> statement-breakpoint

-- Everything that pointed at the 500mm item points at the kept one.
UPDATE "parts" p SET "inventory_item_id" = f.keep_id FROM "merge_fix" f WHERE p."inventory_item_id" = f.drop_id;--> statement-breakpoint
UPDATE "inventory_moves" m SET "item_id" = f.keep_id FROM "merge_fix" f WHERE m."item_id" = f.drop_id;--> statement-breakpoint
UPDATE "inventory_item_history" h SET "item_id" = f.keep_id FROM "merge_fix" f WHERE h."item_id" = f.drop_id;--> statement-breakpoint
DELETE FROM "inventory_link_rejections" r USING "merge_fix" f
WHERE r."item_id" = f.drop_id AND EXISTS (SELECT 1 FROM "inventory_link_rejections" x WHERE x."part_id" = r."part_id" AND x."item_id" = f.keep_id);--> statement-breakpoint
UPDATE "inventory_link_rejections" r SET "item_id" = f.keep_id FROM "merge_fix" f WHERE r."item_id" = f.drop_id;--> statement-breakpoint

-- The stock moves still add up to the stock: one counted move for the difference.
INSERT INTO "inventory_moves" ("item_id", "delta", "reason", "via")
SELECT keep_id, new_stock - moves_stock, 'counted', 'sync' FROM "merge_fix" WHERE abs(new_stock - moves_stock) > 0.0001;--> statement-breakpoint
INSERT INTO "inventory_item_history" ("item_id", "field", "old_value", "new_value", "via")
SELECT keep_id, 'pieces', old_pieces, new_pieces, 'sync' FROM "merge_fix" WHERE new_pieces <> old_pieces;--> statement-breakpoint
UPDATE "inventory_items" i SET "in_stock" = f.new_stock, "pieces" = f.new_pieces, "season_need" = f.new_need
FROM "merge_fix" f WHERE i."id" = f.keep_id;--> statement-breakpoint
DELETE FROM "inventory_items" i USING "merge_fix" f WHERE i."id" = f.drop_id;--> statement-breakpoint
DROP TABLE "merge_fix";--> statement-breakpoint
DROP TABLE "merge_rows";--> statement-breakpoint
DROP TABLE "merge_pair";
