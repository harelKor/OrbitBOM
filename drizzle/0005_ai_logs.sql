CREATE TABLE "ai_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "class_source" NOT NULL,
	"tool" text NOT NULL,
	"member_id" uuid,
	"batch_id" uuid,
	"summary" text NOT NULL,
	"parts" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "part_reviews" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_logs_created_idx" ON "ai_logs" USING btree ("created_at");--> statement-breakpoint
-- Same lockdown as 0001: no policies, so Supabase's public API can't read the table.
ALTER TABLE "ai_logs" ENABLE ROW LEVEL SECURITY;
