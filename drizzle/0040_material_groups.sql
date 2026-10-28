CREATE TABLE "material_groups" (
	"name" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_groups" ENABLE ROW LEVEL SECURITY;