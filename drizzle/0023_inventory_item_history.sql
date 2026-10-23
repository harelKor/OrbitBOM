CREATE TABLE "inventory_item_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"member_id" uuid,
	"via" "change_via" NOT NULL,
	"ai_name" text,
	"visit_id" uuid,
	"page" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_moves" ADD COLUMN "page" text;--> statement-breakpoint
ALTER TABLE "inventory_item_history" ADD CONSTRAINT "inventory_item_history_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_history" ADD CONSTRAINT "inventory_item_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_item_history_item_idx" ON "inventory_item_history" USING btree ("item_id","at");--> statement-breakpoint
CREATE INDEX "inventory_item_history_visit_idx" ON "inventory_item_history" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "inventory_moves_visit_idx" ON "inventory_moves" USING btree ("visit_id");--> statement-breakpoint
ALTER TABLE "inventory_item_history" ENABLE ROW LEVEL SECURITY;
