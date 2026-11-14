ALTER TABLE "inventory_locations" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "outline" jsonb;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "image_w" integer;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "image_h" integer;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "facing" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "spot_x" real;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "spot_y" real;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "drawers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- The old A1..H2 pins become zones (Harel, 2026-11-14): a box around each pin, to be redrawn in
-- Settings → Map; their items stay where they are. Colours from ZONE_COLORS in lib/inventory/places.ts.
WITH ordered AS (
	SELECT "id", "map_x", "map_y", row_number() OVER (ORDER BY "name") - 1 AS n FROM "inventory_locations"
)
UPDATE "inventory_locations" l SET
	"position" = o.n + 1,
	"color" = (ARRAY['#38BDF8','#F472B6','#A3E635','#FBBF24','#A78BFA','#34D399','#FB7185','#60A5FA','#F97316','#2DD4BF','#E879F9','#FACC15'])[(o.n % 12) + 1],
	"outline" = CASE WHEN o."map_x" IS NULL OR o."map_y" IS NULL THEN NULL ELSE jsonb_build_array(
		jsonb_build_array(o."map_x" - 16, o."map_y" - 13),
		jsonb_build_array(o."map_x" + 16, o."map_y" - 13),
		jsonb_build_array(o."map_x" + 16, o."map_y" + 13),
		jsonb_build_array(o."map_x" - 16, o."map_y" + 13)
	) END
FROM ordered o WHERE o."id" = l."id";
