ALTER TABLE "inventory_devices" ADD COLUMN "condition" smallint;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "station" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_station_unique" UNIQUE("station");--> statement-breakpoint
-- PC stations (Harel, 2026-11-20): Computers & Devices is a normal category again, and only the
-- three stations of config/stations.ts work as PCs on the floor plan. Every item in it so far was
-- a test (Harel): gone, its devices, moves and history with it by cascade.
DELETE FROM "inventory_items" WHERE "category" = 'computers-devices' AND "station" IS NULL;--> statement-breakpoint
-- Each PC's own condition (1-5) replaces the category's Type and Condition fields.
UPDATE "inventory_categories" SET "fields" = '[]'::jsonb WHERE "id" = 'computers-devices';--> statement-breakpoint
INSERT INTO "inventory_items" ("name", "category", "station", "in_stock")
VALUES ('Scouting PC', 'computers-devices', 'scouting', 0), ('CAD PC', 'computers-devices', 'cad', 0), ('Build PC', 'computers-devices', 'build', 0)
ON CONFLICT ("station") DO NOTHING;
