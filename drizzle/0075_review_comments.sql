DROP TABLE "design_reviews" CASCADE;--> statement-breakpoint
DROP TABLE "review_rounds" CASCADE;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "is_mentor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP TYPE "public"."review_status";--> statement-breakpoint
DROP TYPE "public"."review_round_state";--> statement-breakpoint
CREATE TYPE "public"."review_comment_state" AS ENUM('open', 'done', 'approved');--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"part_key" text,
	"part_name" text,
	"state" "review_comment_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"done_version_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"reject_note" text,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid
);
--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_done_by_members_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_done_version_id_system_versions_id_fk" FOREIGN KEY ("done_version_id") REFERENCES "public"."system_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_approved_by_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_rejected_by_members_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comments_system_idx" ON "review_comments" USING btree ("system_id","created_at");--> statement-breakpoint
ALTER TABLE "review_comments" ENABLE ROW LEVEL SECURITY;
