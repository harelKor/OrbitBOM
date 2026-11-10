CREATE TABLE "assembly_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"sub_code" text,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'step' NOT NULL,
	"sub_ref" text,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"part_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"camera" jsonb,
	"image_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_subs" (
	"system_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "assembly_subs_system_id_code_pk" PRIMARY KEY("system_id","code")
);
--> statement-breakpoint
CREATE TABLE "assembly_ticks" (
	"step_id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assembly_steps" ADD CONSTRAINT "assembly_steps_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_steps" ADD CONSTRAINT "assembly_steps_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_subs" ADD CONSTRAINT "assembly_subs_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_ticks" ADD CONSTRAINT "assembly_ticks_step_id_assembly_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."assembly_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_ticks" ADD CONSTRAINT "assembly_ticks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assembly_steps_place_idx" ON "assembly_steps" USING btree ("system_id","sub_code","position");--> statement-breakpoint
ALTER TABLE "assembly_subs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assembly_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assembly_ticks" ENABLE ROW LEVEL SECURITY;
