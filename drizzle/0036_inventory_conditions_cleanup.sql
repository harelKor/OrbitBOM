-- Drop the old seeded conditions (Harel, 2026-10-28). Items on plain "Used" move to "Used / Worn"
-- first; items on the others lose their condition (the foreign key sets it to null), none are deleted.
INSERT INTO "inventory_conditions" ("label", "color")
SELECT 'Used / Worn', '#f59e0b'
WHERE EXISTS (SELECT 1 FROM "inventory_conditions" WHERE lower("label") = 'used')
  AND NOT EXISTS (SELECT 1 FROM "inventory_conditions" WHERE lower("label") = 'used / worn');--> statement-breakpoint
UPDATE "inventory_items"
SET "condition_id" = (SELECT "id" FROM "inventory_conditions" WHERE lower("label") = 'used / worn' ORDER BY "label" LIMIT 1)
WHERE "condition_id" IN (SELECT "id" FROM "inventory_conditions" WHERE lower("label") = 'used');--> statement-breakpoint
DELETE FROM "inventory_conditions"
WHERE lower("label") IN ('for robot a', 'for robot b', 'for prototyping', 'used', 'old');
