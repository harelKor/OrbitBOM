CREATE TYPE "public"."change_via" AS ENUM('ui', 'sync', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."class_source" AS ENUM('rule', 'ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."classification" AS ENUM('inhouse', 'cots', 'external');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."part_file_type" AS ENUM('drawing', 'gcode', 'image', 'flattened');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."sync_job_state" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "group_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"type" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"key_snapshot" jsonb NOT NULL,
	CONSTRAINT "group_members_group_id_part_id_pk" PRIMARY KEY("group_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	CONSTRAINT "inventory_conditions_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "inventory_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"template_id" text,
	"location_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid,
	"template_id" text,
	"template_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition_id" uuid,
	"location_id" uuid,
	"in_stock" integer DEFAULT 0 NOT NULL,
	"material" text,
	"image_path" text,
	"vendor_url" text,
	"vendor_name" text,
	"price" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "inventory_locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"created_by" uuid NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"onshape_connected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "merge_members" (
	"merge_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	CONSTRAINT "merge_members_merge_id_part_id_pk" PRIMARY KEY("merge_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"name" text NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onshape_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"microversion" text,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onshape_tokens" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"calls_today" integer DEFAULT 0 NOT NULL,
	"calls_day" date
);
--> statement-breakpoint
CREATE TABLE "part_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"type" "part_file_type" NOT NULL,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"member_id" uuid,
	"via" "change_via" NOT NULL,
	"batch_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"source_did" text,
	"source_wid" text,
	"source_eid" text,
	"source_wvm" text,
	"onshape_part_id" text,
	"onshape_name" text,
	"is_manual" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"part_number" text,
	"classification" "classification" DEFAULT 'inhouse' NOT NULL,
	"description" text,
	"material" text,
	"inventory_item_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"pre_process" text,
	"process1" text,
	"process2" text,
	"extra_processes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"done_preprocess" integer DEFAULT 0 NOT NULL,
	"done_process1" integer DEFAULT 0 NOT NULL,
	"done_process2" integer DEFAULT 0 NOT NULL,
	"design_state" text,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"deadline" date,
	"designer_name" text,
	"fabricators" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"est_minutes" integer,
	"actual_minutes" integer,
	"drawing_url" text,
	"dxf_face" text,
	"box_qty" integer,
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"geometry" jsonb,
	"class_guess" text,
	"class_source" "class_source",
	"thumbnail_rev" text,
	"removed_from_cad_at" timestamp with time zone,
	"last_modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_modified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"code" text,
	"deadline" date,
	"main_assembly_url" text,
	"schematic_path" text,
	"thumbnail_path" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" "sync_job_state" DEFAULT 'queued' NOT NULL,
	"step" text,
	"diff" jsonb,
	"error" text,
	"by_member" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"assembly_url" text,
	"subassembly_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"partstudio_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"push_names_to_onshape" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"doc_microversions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thumbnail_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_files" ADD CONSTRAINT "group_files_group_id_part_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."part_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_part_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."part_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_groups" ADD CONSTRAINT "inventory_groups_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_group_id_inventory_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."inventory_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_condition_id_inventory_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."inventory_conditions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_members_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_members" ADD CONSTRAINT "merge_members_merge_id_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."merges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_members" ADD CONSTRAINT "merge_members_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merges" ADD CONSTRAINT "merges_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onshape_tokens" ADD CONSTRAINT "onshape_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_files" ADD CONSTRAINT "part_files_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_files" ADD CONSTRAINT "part_files_uploaded_by_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_groups" ADD CONSTRAINT "part_groups_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_history" ADD CONSTRAINT "part_history_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_history" ADD CONSTRAINT "part_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_last_modified_by_members_id_fk" FOREIGN KEY ("last_modified_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_by_member_members_id_fk" FOREIGN KEY ("by_member") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "systems" ADD CONSTRAINT "systems_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merge_members_part_uq" ON "merge_members" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_files_part_idx" ON "part_files" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_history_part_idx" ON "part_history" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_history_batch_idx" ON "part_history" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "parts_system_idx" ON "parts" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "parts_identity_idx" ON "parts" USING btree ("source_did","source_eid","onshape_part_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_system_idx" ON "sync_jobs" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "systems_robot_idx" ON "systems" USING btree ("robot_id");