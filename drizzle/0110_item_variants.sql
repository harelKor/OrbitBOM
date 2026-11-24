-- A fresh database runs every migration in one transaction, and 0100's inventory_items rows leave
-- deferred data_version trigger events pending, which block ALTER TABLE: fire them now.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "inventory_conditions" ADD COLUMN "only_for" jsonb;--> statement-breakpoint
ALTER TABLE "inventory_conditions" ADD COLUMN "uncounted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD COLUMN "variant_id" text;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
-- Defective (Harel, 2026-11-24): red, shown on an item's variants but counted toward nothing, and
-- offered only on Electrical and Computers & Devices. A Defective condition someone already made
-- gets the same rules.
INSERT INTO "inventory_conditions" ("label", "color", "uncounted", "only_for")
VALUES ('Defective', '#ef4444', true, '{"groups":["electrical"],"categories":["computers-devices"]}'::jsonb)
ON CONFLICT ("label") DO UPDATE SET "uncounted" = true, "only_for" = EXCLUDED."only_for";--> statement-breakpoint
-- Printed is offered only on Gears and Pulleys; items already Printed elsewhere keep it.
UPDATE "inventory_conditions" SET "only_for" = '{"categories":["gears","pulleys"]}'::jsonb WHERE "label" = 'Printed';
