CREATE TABLE "design_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"whole_robot" boolean DEFAULT true NOT NULL,
	"system_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text NOT NULL,
	"robot_version_id" uuid,
	"version_label" text,
	"finish_version_id" uuid,
	"finish_version_label" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_by" uuid,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "anchor" jsonb;--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "design_review_id" uuid;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_robot_version_id_robot_versions_id_fk" FOREIGN KEY ("robot_version_id") REFERENCES "public"."robot_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_finish_version_id_robot_versions_id_fk" FOREIGN KEY ("finish_version_id") REFERENCES "public"."robot_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_started_by_members_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_finished_by_members_id_fk" FOREIGN KEY ("finished_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_reviews_seq_uq" ON "design_reviews" USING btree ("robot_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "design_reviews_open_uq" ON "design_reviews" USING btree ("robot_id") WHERE "design_reviews"."finished_at" IS NULL;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_design_review_id_design_reviews_id_fk" FOREIGN KEY ("design_review_id") REFERENCES "public"."design_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comments_design_review_idx" ON "review_comments" USING btree ("design_review_id");--> statement-breakpoint
ALTER TABLE "design_reviews" ENABLE ROW LEVEL SECURITY;
