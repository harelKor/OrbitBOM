CREATE TABLE "stored_files" (
	"key" text PRIMARY KEY NOT NULL,
	"bytes" bigint NOT NULL,
	"kind" text NOT NULL,
	"version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_version_id_system_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."system_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_version_idx" ON "stored_files" USING btree ("version_id");--> statement-breakpoint
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "part_versions" ENABLE ROW LEVEL SECURITY;
