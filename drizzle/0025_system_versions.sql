CREATE TYPE "public"."part_change" AS ENUM('baseline', 'added', 'modified', 'removed');--> statement-breakpoint
CREATE TYPE "public"."version_state" AS ENUM('draft', 'committed');--> statement-breakpoint
CREATE TABLE "part_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"change" "part_change" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"mesh_key" text
);
--> statement-breakpoint
CREATE TABLE "system_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"state" "version_state" NOT NULL,
	"seq" integer,
	"name" text,
	"onshape_ref" jsonb,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detected_by" uuid,
	"committed_at" timestamp with time zone,
	"committed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "onshape_mv" text;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "version_row_id" uuid;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "part_versions" ADD CONSTRAINT "part_versions_version_id_system_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."system_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_versions" ADD CONSTRAINT "part_versions_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_versions" ADD CONSTRAINT "system_versions_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_versions" ADD CONSTRAINT "system_versions_detected_by_members_id_fk" FOREIGN KEY ("detected_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_versions" ADD CONSTRAINT "system_versions_committed_by_members_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_versions_part_idx" ON "part_versions" USING btree ("part_id","version_id");--> statement-breakpoint
CREATE INDEX "part_versions_version_idx" ON "part_versions" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_versions_seq_uq" ON "system_versions" USING btree ("system_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "system_versions_draft_uq" ON "system_versions" USING btree ("system_id") WHERE "system_versions"."state" = 'draft';