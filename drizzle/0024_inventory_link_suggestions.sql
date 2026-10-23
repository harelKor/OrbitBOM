CREATE TABLE "inventory_link_rejections" (
	"part_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"member_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_link_rejections_part_id_item_id_pk" PRIMARY KEY("part_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "part_reviews" ADD COLUMN "pending" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "thumb_hash" text;--> statement-breakpoint
ALTER TABLE "inventory_link_rejections" ADD CONSTRAINT "inventory_link_rejections_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_link_rejections" ADD CONSTRAINT "inventory_link_rejections_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_link_rejections" ADD CONSTRAINT "inventory_link_rejections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_link_rejections" ENABLE ROW LEVEL SECURITY;
