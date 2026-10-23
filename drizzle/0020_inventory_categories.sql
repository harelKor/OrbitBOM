CREATE TABLE "inventory_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"noun" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sheet" boolean DEFAULT false NOT NULL,
	"default_location_id" uuid,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "specs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "cots_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_default_location_id_inventory_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Part types and the free material go away: their values become the category's fields.
UPDATE "inventory_items" SET "specs" = "template_values" || CASE WHEN "material" IS NOT NULL AND "material" <> '' THEN jsonb_build_object('material', "material") ELSE '{}'::jsonb END;--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = jsonb_set("specs", '{bore}', to_jsonb(CASE "specs"->>'bore' WHEN '1/2In HEX' THEN '1/2" Hex' WHEN '3/8In HEX' THEN '3/8" Hex' ELSE "specs"->>'bore' END)) WHERE "specs" ? 'bore';--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = jsonb_set("specs", '{pitch}', to_jsonb(CASE "specs"->>'pitch' WHEN 'GT2-3' THEN 'GT2 3mm' WHEN 'HTD-5' THEN 'HTD 5mm' ELSE "specs"->>'pitch' END)) WHERE "specs" ? 'pitch';--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = ("specs" - 'type') || jsonb_build_object('chain', "specs"->>'type') WHERE "template_id" = 'sprockets' AND "specs" ? 'type';--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = ("specs" - 'thickness') || jsonb_build_object('width', "specs"->>'thickness') WHERE "template_id" IN ('pulleys', 'gears') AND "specs" ? 'thickness';--> statement-breakpoint
-- Gears / Pulleys / Sprockets split into one category each.
UPDATE "inventory_items" SET "category" = CASE "template_id" WHEN 'pulleys' THEN 'pulleys' WHEN 'gears' THEN 'gears' WHEN 'sprockets' THEN 'sprockets' ELSE NULL END WHERE "category" = 'motion';--> statement-breakpoint
UPDATE "inventory_items" SET "cots_links" = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('url', "vendor_url", 'site', "vendor_name"))) WHERE "vendor_url" IS NOT NULL AND "vendor_url" <> '';
--> statement-breakpoint
UPDATE "inventory_items" SET "category" = CASE "template_id" WHEN 'pulleys' THEN 'pulleys' WHEN 'gears' THEN 'gears' WHEN 'sprockets' THEN 'sprockets' WHEN 'belts' THEN 'belts' WHEN 'radial-bearings' THEN 'bearings' WHEN 'flanged-bearings' THEN 'bearings' WHEN 'aluminum-plates' THEN 'aluminum-plates' WHEN 'polycarbonate-plates' THEN 'polycarbonate' WHEN 'aluminum-tubes' THEN 'round-tubes' WHEN 'polycarbonate-tubes' THEN 'round-tubes' WHEN 'aluminum-extrusions' THEN 'square-tubes' WHEN 'filament' THEN 'filament' WHEN 'wires' THEN 'electrical' ELSE NULL END WHERE "category" IS NULL AND "template_id" IS NOT NULL;--> statement-breakpoint
UPDATE "inventory_items" SET "specs" = "specs" || '{"flanged": "Flanged"}'::jsonb WHERE "template_id" = 'flanged-bearings';
