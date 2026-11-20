CREATE TABLE "inventory_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"x" real DEFAULT 0.5 NOT NULL,
	"y" real DEFAULT 0.5 NOT NULL,
	"keyboard" boolean DEFAULT false NOT NULL,
	"mouse" boolean DEFAULT false NOT NULL,
	"note" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_categories" ADD COLUMN "devices" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_devices" ADD CONSTRAINT "inventory_devices_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_devices_item_idx" ON "inventory_devices" USING btree ("item_id","position");--> statement-breakpoint
ALTER TABLE "inventory_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Computers & Devices (Harel, 2026-11-20): one item per station's kind of computer, its stock its
-- devices. An empty table is seeded from config/inventory.ts on first read, so only teams already
-- seeded get it here.
INSERT INTO "inventory_categories" ("id", "label", "noun", "group", "sheet", "devices", "position", "fields")
SELECT 'computers-devices', 'Computers & Devices', '', 'tools', false, true, (SELECT coalesce(max("position"), 0) + 1 FROM "inventory_categories"),
  '[{"id":"type","label":"Type","kind":"options","options":["Laptop","PC","Tablet"],"name":""},{"id":"condition","label":"Condition","kind":"number","name":""}]'::jsonb
WHERE EXISTS (SELECT 1 FROM "inventory_categories")
ON CONFLICT ("id") DO UPDATE SET "devices" = true;
