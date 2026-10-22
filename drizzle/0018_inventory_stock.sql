CREATE TYPE "public"."stock_reason" AS ENUM('received', 'used', 'broke', 'counted', 'returned');--> statement-breakpoint
CREATE TABLE "inventory_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"delta" double precision NOT NULL,
	"reason" "stock_reason" NOT NULL,
	"part_id" uuid,
	"member_id" uuid,
	"via" "change_via" NOT NULL,
	"ai_name" text,
	"batch_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ALTER COLUMN "in_stock" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "onshape_key" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD CONSTRAINT "inventory_moves_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD CONSTRAINT "inventory_moves_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD CONSTRAINT "inventory_moves_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_moves_item_idx" ON "inventory_moves" USING btree ("item_id","at");--> statement-breakpoint
CREATE INDEX "inventory_moves_batch_idx" ON "inventory_moves" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "inventory_moves" ENABLE ROW LEVEL SECURITY;