CREATE TABLE "inventory_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"item_id" uuid,
	"category_id" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"member_id" uuid,
	"batch_id" uuid,
	"ai_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reviews_item_id_unique" UNIQUE("item_id"),
	CONSTRAINT "inventory_reviews_category_id_unique" UNIQUE("category_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_logs" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_categories" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_item_history" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_reviews" ADD CONSTRAINT "inventory_reviews_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reviews" ADD CONSTRAINT "inventory_reviews_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reviews" ADD CONSTRAINT "inventory_reviews_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_logs_batch_idx" ON "ai_logs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "inventory_item_history_batch_idx" ON "inventory_item_history" USING btree ("batch_id");