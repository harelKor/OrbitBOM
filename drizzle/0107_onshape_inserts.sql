CREATE TABLE "onshape_inserts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_did" text NOT NULL,
	"target_wid" text NOT NULL,
	"target_eid" text NOT NULL,
	"target_kind" text NOT NULL,
	"created_ids" text[] NOT NULL,
	"source_did" text NOT NULL,
	"source_eid" text NOT NULL,
	"part_ids" text[] NOT NULL,
	"version_id" text NOT NULL,
	"label" text NOT NULL,
	"system_id" uuid,
	"item_id" uuid,
	"model" text,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onshape_inserts" ADD CONSTRAINT "onshape_inserts_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onshape_inserts" ADD CONSTRAINT "onshape_inserts_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onshape_inserts" ADD CONSTRAINT "onshape_inserts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onshape_inserts_target_idx" ON "onshape_inserts" USING btree ("target_did","target_eid");
--> statement-breakpoint
ALTER TABLE "onshape_inserts" ENABLE ROW LEVEL SECURITY;