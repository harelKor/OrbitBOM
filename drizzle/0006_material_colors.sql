CREATE TABLE "material_colors" (
	"category" text PRIMARY KEY NOT NULL,
	"color" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_colors" ADD CONSTRAINT "material_colors_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Same lockdown as 0001: no policies, so Supabase's public API can't read the table.
ALTER TABLE "material_colors" ENABLE ROW LEVEL SECURITY;
