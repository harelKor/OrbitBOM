CREATE TABLE "part_reviews" (
	"part_id" uuid PRIMARY KEY NOT NULL,
	"source" "class_source" NOT NULL,
	"reason" text,
	"changes" jsonb NOT NULL,
	"added_overrides" text[] DEFAULT '{}'::text[] NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "part_reviews" ADD CONSTRAINT "part_reviews_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_reviews" ADD CONSTRAINT "part_reviews_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Same lockdown as 0001: no policies, so Supabase's public API can't read the table.
ALTER TABLE "part_reviews" ENABLE ROW LEVEL SECURITY;
