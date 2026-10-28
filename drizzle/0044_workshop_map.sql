-- Workshop map (Harel, 2026-10-28): each location can sit on the floor plan. The 16 shelf pins
-- A1..H2 are added (or, when a location of that name exists, given its spot); other locations
-- and their items are left alone.
ALTER TABLE "inventory_locations" ADD COLUMN "map_x" real;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "map_y" real;--> statement-breakpoint
INSERT INTO "inventory_locations" ("name", "map_x", "map_y") VALUES ('A1', 356, 312), ('A2', 317, 312), ('B1', 318, 95), ('B2', 285, 100), ('B3', 233, 98), ('C1', 247, 210), ('C2', 226, 183), ('D1', 359, 215), ('D2', 311, 217), ('E1', 706, 492), ('E2', 765, 460), ('F1', 506, 338), ('G1', 873, 291), ('G2', 782, 142), ('H1', 103, 263), ('H2', 84, 198)
ON CONFLICT ("name") DO UPDATE SET "map_x" = COALESCE("inventory_locations"."map_x", EXCLUDED."map_x"), "map_y" = COALESCE("inventory_locations"."map_y", EXCLUDED."map_y");
