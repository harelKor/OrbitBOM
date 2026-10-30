-- Name templates carry their own spacing (Harel, 2026-10-30): " {}mm" puts a space before the
-- value, "x{}" sticks to the value before it. Every template the team has today got that space
-- from buildName, so it is written into the template, and built names stay the same. Raw Stock
-- lengths and sheet sizes leave item names (a box tube's size is its profile and stays). The
-- categories are backed up first (onshape_cache "inventory-seed:name-templates-backup-2026-10-30").
INSERT INTO "onshape_cache" ("key", "payload")
SELECT 'inventory-seed:name-templates-backup-2026-10-30', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c."id", 'fields', c."fields")) FROM "inventory_categories" c), '[]'::jsonb)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "inventory_categories" c SET "fields" = (
  SELECT jsonb_agg(
    CASE
      WHEN c."group" = 'consumables' AND (f->>'id' = 'length' OR (f->>'id' = 'size' AND c."id" <> 'square-tubes')) THEN f || '{"name": ""}'::jsonb
      WHEN f->>'name' IS NOT NULL AND f->>'name' <> '' AND f->>'name' !~ '^\s' THEN f || jsonb_build_object('name', ' ' || (f->>'name'))
      ELSE f END ORDER BY n)
  FROM jsonb_array_elements(c."fields") WITH ORDINALITY AS e(f, n)
) WHERE jsonb_array_length(c."fields") > 0;
