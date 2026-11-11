CREATE TABLE "named_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"view" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "view" jsonb;--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "pin" jsonb;--> statement-breakpoint
ALTER TABLE "named_views" ADD CONSTRAINT "named_views_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "named_views" ADD CONSTRAINT "named_views_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "named_views_robot_idx" ON "named_views" USING btree ("robot_id","name");--> statement-breakpoint
ALTER TABLE "named_views" ENABLE ROW LEVEL SECURITY;
