-- Shorter condition names (Harel, 2026-11-02): "Used / Worn" becomes "Worn" and "3D Printed"
-- becomes "Printed", so the condition pill stays small next to the other tags. Items point at the
-- condition by id, so only the label changes. Skipped when the short name already exists.
UPDATE "inventory_conditions" SET "label" = 'Worn'
WHERE "label" = 'Used / Worn' AND NOT EXISTS (SELECT 1 FROM "inventory_conditions" WHERE "label" = 'Worn');--> statement-breakpoint
UPDATE "inventory_conditions" SET "label" = 'Printed'
WHERE "label" = '3D Printed' AND NOT EXISTS (SELECT 1 FROM "inventory_conditions" WHERE "label" = 'Printed');
