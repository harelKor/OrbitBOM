CREATE TABLE "part_drawings" (
	"part_id" uuid PRIMARY KEY NOT NULL,
	"rev" text,
	"part" jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "part_drawings" ADD CONSTRAINT "part_drawings_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_drawings" ADD CONSTRAINT "part_drawings_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Same lockdown as 0001: no policies, so Supabase's public API can't read the table.
ALTER TABLE "part_drawings" ENABLE ROW LEVEL SECURITY;