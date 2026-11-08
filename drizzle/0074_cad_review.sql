CREATE TYPE "public"."review_status" AS ENUM('open', 'approved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."review_round_state" AS ENUM('building', 'ready');--> statement-breakpoint
CREATE TABLE "design_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"system_id" uuid,
	"title" text NOT NULL,
	"assembly_url" text NOT NULL,
	"owner_id" uuid,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"onshape_ref" jsonb NOT NULL,
	"state" "review_round_state" DEFAULT 'building' NOT NULL,
	"model" jsonb,
	"note" text,
	"error" text,
	"calls" integer DEFAULT 0 NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"built_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "follow_versions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "followed_version_id" text;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_approved_by_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_review_id_design_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."design_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_sent_by_members_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_reviews_robot_idx" ON "design_reviews" USING btree ("robot_id","activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_rounds_seq_uq" ON "review_rounds" USING btree ("review_id","seq");--> statement-breakpoint
ALTER TABLE "design_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_rounds" ENABLE ROW LEVEL SECURITY;
