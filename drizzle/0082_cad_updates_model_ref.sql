CREATE TABLE "cad_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"did" text NOT NULL,
	"microversion" text NOT NULL,
	"onshape_version_id" text,
	"parent_version_id" text,
	"label" text NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "model_ref" jsonb;--> statement-breakpoint
ALTER TABLE "cad_updates" ADD CONSTRAINT "cad_updates_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_updates" ADD CONSTRAINT "cad_updates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cad_updates_system_idx" ON "cad_updates" USING btree ("system_id","created_at");
--> statement-breakpoint
ALTER TABLE "cad_updates" ENABLE ROW LEVEL SECURITY;