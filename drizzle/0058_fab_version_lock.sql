CREATE TABLE "part_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"version_id" uuid,
	"row_id" uuid,
	"status" text NOT NULL,
	"member_id" uuid,
	"batch_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "released_version_id" uuid;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "released_row_id" uuid;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "released_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "part_releases" ADD CONSTRAINT "part_releases_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_releases" ADD CONSTRAINT "part_releases_version_id_system_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."system_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_releases" ADD CONSTRAINT "part_releases_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_releases_part_idx" ON "part_releases" USING btree ("part_id");--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_released_version_id_system_versions_id_fk" FOREIGN KEY ("released_version_id") REFERENCES "public"."system_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_releases" ENABLE ROW LEVEL SECURITY;