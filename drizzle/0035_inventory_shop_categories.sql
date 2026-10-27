-- New inventory categories for the shop spreadsheet (Harel, 2026-10-27). An empty table is
-- seeded from config/inventory.ts on first read, so only teams already seeded get them here.
INSERT INTO "inventory_categories" ("id", "label", "noun", "group", "sheet", "position", "fields")
SELECT v.id, v.label, v.noun, v.grp, v.sheet, (SELECT coalesce(max("position"), 0) FROM "inventory_categories") + v.n, v.fields::jsonb
FROM (VALUES
  ('pinions-adapters', 'Pinions & adapters', '', 'cots', false, 1, '[{"id":"teeth","label":"Teeth","kind":"number","name":"{}T"},{"id":"spline","label":"Spline","kind":"options","options":["SplineXS","Falcon","Kraken","RS775","1/2\" Hex","3/8\" Hex"]}]'),
  ('gearboxes', 'Gearboxes', '', 'cots', false, 2, '[{"id":"type","label":"Type","kind":"options","options":["MAXPlanetary","VersaPlanetary","Cycloidal","Other"]},{"id":"ratio","label":"Ratio","kind":"text","name":"{}"}]'),
  ('cnc-bits', 'CNC bits', '', 'tools', false, 3, '[{"id":"type","label":"Type","kind":"text"},{"id":"size","label":"Size","kind":"text"}]'),
  ('lathe-tools', 'Lathe tools', '', 'tools', false, 4, '[{"id":"for","label":"For","kind":"options","options":["Aluminum","Steel"]}]'),
  ('drills-taps', 'Drills & taps', '', 'tools', false, 5, '[{"id":"kind","label":"Kind","kind":"options","options":["Drill bit","Tap"]},{"id":"size","label":"Size","kind":"text"}]'),
  ('carbon-tubes', 'Carbon tubes', 'Carbon tube', 'consumables', false, 6, '[{"id":"shape","label":"Shape","kind":"options","options":["Round","Square"]},{"id":"od","label":"OD","kind":"text","name":"Ø{}"},{"id":"wall","label":"Wall (mm)","kind":"text","name":"{}mm wall"},{"id":"length","label":"Length","kind":"options","options":["500mm","700mm"]}]'),
  ('wood-composites', 'Wood & composites', 'Sheet', 'consumables', true, 7, '[{"id":"material","label":"Material","kind":"options","options":["Birch","Sandwich","MDF","SRPP"]},{"id":"thickness","label":"Thickness (mm)","kind":"number","name":"{}mm"},{"id":"size","label":"Sheet size (mm)","kind":"text","name":"{}mm"}]')
) AS v(id, label, noun, grp, sheet, n, fields)
WHERE EXISTS (SELECT 1 FROM "inventory_categories")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Screws are tracked by size, head and length.
UPDATE "inventory_categories" SET "fields" = '[{"id":"size","label":"Size","kind":"text"},{"id":"head","label":"Head","kind":"options","options":["Socket","Button","Flat","Rivet","Rivet, large head"]},{"id":"length","label":"Length (mm)","kind":"text"}]'::jsonb WHERE "id" = 'fasteners';
