-- Hardware replaces the Bumpers & Field group (Harel, 2026-10-28): fasteners and shop supplies move
-- into it; Bumper materials and Field elements go, their items (if any) to Other.
UPDATE "inventory_categories" SET "group" = 'hardware' WHERE "id" IN ('fasteners', 'shop-supplies');--> statement-breakpoint
UPDATE "inventory_items" SET "category" = 'other' WHERE "category" IN ('bumper-materials', 'field-elements');--> statement-breakpoint
UPDATE "parts" SET "cots_category" = 'other' WHERE "cots_category" IN ('bumper-materials', 'field-elements');--> statement-breakpoint
DELETE FROM "inventory_categories" WHERE "id" IN ('bumper-materials', 'field-elements');--> statement-breakpoint
UPDATE "inventory_categories" SET "group" = 'general' WHERE "group" = 'bumpers';
