ALTER TABLE "inventory_categories" ADD COLUMN "group" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "season_need" double precision;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "restock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "inventory_categories" SET "group" = CASE "id"
  WHEN 'gears' THEN 'cots' WHEN 'pulleys' THEN 'cots' WHEN 'sprockets' THEN 'cots' WHEN 'belts' THEN 'cots'
  WHEN 'bearings' THEN 'cots' WHEN 'wheels' THEN 'cots'
  WHEN 'shafts' THEN 'consumables' WHEN 'round-tubes' THEN 'consumables' WHEN 'square-tubes' THEN 'consumables'
  WHEN 'aluminum-plates' THEN 'consumables' WHEN 'polycarbonate' THEN 'consumables' WHEN 'filament' THEN 'consumables'
  WHEN 'motors' THEN 'electrical' WHEN 'electrical' THEN 'electrical'
  ELSE 'general' END;--> statement-breakpoint
INSERT INTO "inventory_categories" ("id", "label", "noun", "group", "position", "fields")
SELECT v.id, v.label, v.noun, v.grp, (SELECT coalesce(max("position"), 0) FROM "inventory_categories") + v.n, v.fields::jsonb
FROM (VALUES
  ('shop-supplies', 'Shop supplies', '', 'consumables', 1, '[]'),
  ('controllers', 'Controllers & sensors', '', 'electrical', 2, '[]'),
  ('wiring', 'Wiring & connectors', '', 'electrical', 3, '[]'),
  ('batteries', 'Batteries', 'Battery', 'electrical', 4, '[]'),
  ('chain', 'Chain', 'Chain', 'cots', 5, '[{"id":"chain","label":"Chain","kind":"options","options":["#25","#35"]}]'),
  ('hubs-spacers', 'Hubs & spacers', '', 'cots', 6, '[]'),
  ('fasteners', 'Fasteners', '', 'tools', 7, '[{"id":"size","label":"Size","kind":"text"},{"id":"length","label":"Length","kind":"text"}]'),
  ('hand-tools', 'Hand tools', '', 'tools', 8, '[]'),
  ('power-tools', 'Power tools & bits', '', 'tools', 9, '[]'),
  ('bumper-materials', 'Bumper materials', '', 'bumpers', 10, '[]'),
  ('field-elements', 'Field elements', '', 'bumpers', 11, '[]')
) AS v(id, label, noun, grp, n, fields)
-- An empty table is seeded from config/inventory.ts on first read; leave it empty.
WHERE EXISTS (SELECT 1 FROM "inventory_categories")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- COTS cards now file under inventory categories; the old "Gears / Pulleys / Sprockets" box splits by name.
UPDATE "parts" SET "cots_category" = CASE
  WHEN coalesce("display_name", "onshape_name", '') ~* 'pulley' THEN 'pulleys'
  WHEN coalesce("display_name", "onshape_name", '') ~* 'sprocket' THEN 'sprockets'
  WHEN coalesce("display_name", "onshape_name", '') ~* '\mhubs?\M' THEN 'hubs-spacers'
  ELSE 'gears' END
WHERE "cots_category" = 'motion';
