CREATE TABLE "base_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "base_materials_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "base_materials" ENABLE ROW LEVEL SECURITY;
