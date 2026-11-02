CREATE TABLE "cots_order_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid,
	"part_id" uuid,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" real,
	"vendor" text,
	"product_url" text,
	"in_route_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"in_route_text" text,
	"arrived_text" text,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cots_order_history" ADD CONSTRAINT "cots_order_history_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cots_order_history" ADD CONSTRAINT "cots_order_history_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cots_order_history_part_idx" ON "cots_order_history" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "cots_order_history_item_idx" ON "cots_order_history" USING btree ("inventory_item_id");--> statement-breakpoint
-- RLS on with no policies, like every table: only the server (Drizzle) reads it.
ALTER TABLE "cots_order_history" ENABLE ROW LEVEL SECURITY;
